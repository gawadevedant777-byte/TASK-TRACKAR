#pragma once
#include <vector>
#include <map>
#include <string>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <stdexcept>
#include "models.hpp"
#include "../include/json.hpp"

using json = nlohmann::json;

// ─────────────────────────────────────────────
//  DataStore  –  in-memory + file persistence
// ─────────────────────────────────────────────
class DataStore {
public:
    std::map<int, Folder> folders;
    std::vector<Task>     tasks;
    WeeklyTracker         tracker;

    int next_folder_id = 1;
    int next_task_id   = 1;

    std::string folder_file;
    std::string task_file;

    // ── constructor ──────────────────────────
    DataStore(const std::string& data_dir) {
        folder_file = data_dir + "/folders.json";
        task_file   = data_dir + "/tasks.json";
        load_all();
        seed_defaults_if_empty();
    }

    // ── FOLDER CRUD ──────────────────────────
    Folder& add_folder(const std::string& name,
                       int parent_id = -1,
                       const std::string& color = "#6366f1") {
        Folder f;
        f.id        = next_folder_id++;
        f.parent_id = parent_id;
        f.name      = name;
        f.color     = color;
        folders[f.id] = f;
        if (parent_id != -1 && folders.count(parent_id)) {
            folders[parent_id].children_ids.push_back(f.id);
        }
        save_folders();
        return folders[f.id];
    }

    bool update_folder(int id, const std::string& name, const std::string& color, int parent_id = -2) {
        if (!folders.count(id)) return false;
        if (!name.empty())  folders[id].name  = name;
        if (!color.empty()) folders[id].color = color;
        if (parent_id != -2 && parent_id != id) {
            // detach from old parent
            int old_pid = folders[id].parent_id;
            if (old_pid != -1 && folders.count(old_pid)) {
                auto& ch = folders[old_pid].children_ids;
                ch.erase(std::remove(ch.begin(), ch.end(), id), ch.end());
            }
            folders[id].parent_id = parent_id;
            if (parent_id != -1 && folders.count(parent_id)) {
                folders[parent_id].children_ids.push_back(id);
            }
        }
        save_folders();
        return true;
    }

    bool delete_folder(int id) {
        if (!folders.count(id)) return false;
        // detach from parent
        int pid = folders[id].parent_id;
        if (pid != -1 && folders.count(pid)) {
            auto& ch = folders[pid].children_ids;
            ch.erase(std::remove(ch.begin(), ch.end(), id), ch.end());
        }
        delete_folder_recursive(id);
        rebuild_tracker();
        save_all();
        return true;
    }

    json get_folders_tree() const {
        json arr = json::array();
        for (auto it = folders.begin(); it != folders.end(); ++it)
            arr.push_back(it->second.to_json());
        return arr;
    }

    // ── TASK CRUD ────────────────────────────
    Task& add_task(const std::string& title,
                   const std::string& desc,
                   const std::string& date,
                   int folder_id,
                   const std::string& type     = "task",
                   const std::string& priority = "medium",
                   const std::string& status   = "pending") {
        Task t;
        t.id          = next_task_id++;
        t.folder_id   = folder_id;
        t.title       = title;
        t.description = desc;
        t.date        = date;
        t.status      = status.empty() ? "pending" : status;
        t.type        = type.empty() ? "task" : type;
        t.priority    = priority.empty() ? "medium" : priority;
        t.created_at  = (int)time(nullptr);
        tasks.push_back(t);
        rebuild_tracker();
        save_tasks();
        return tasks.back();
    }

    bool update_task(int id, const json& patch) {
        for (auto& t : tasks) {
            if (t.id == id) {
                if (patch.contains("title") && patch["title"].is_string())
                    t.title = patch["title"].get<std::string>();
                if (patch.contains("description") && patch["description"].is_string())
                    t.description = patch["description"].get<std::string>();
                if (patch.contains("date") && patch["date"].is_string())
                    t.date = patch["date"].get<std::string>();
                if (patch.contains("folder_id") && patch["folder_id"].is_number())
                    t.folder_id = patch["folder_id"].get<int>();
                if (patch.contains("status") && patch["status"].is_string())
                    t.status = patch["status"].get<std::string>();
                if (patch.contains("priority") && patch["priority"].is_string())
                    t.priority = patch["priority"].get<std::string>();
                if (patch.contains("type") && patch["type"].is_string())
                    t.type = patch["type"].get<std::string>();

                rebuild_tracker();
                save_tasks();
                return true;
            }
        }
        return false;
    }

    bool toggle_task(int id) {
        for (auto& t : tasks) {
            if (t.id == id) {
                t.status = (t.status == "done") ? "pending" : "done";
                rebuild_tracker();
                save_tasks();
                return true;
            }
        }
        return false;
    }

    bool delete_task(int id) {
        auto it = std::remove_if(tasks.begin(), tasks.end(),
                                 [id](const Task& t){ return t.id == id; });
        if (it == tasks.end()) return false;
        tasks.erase(it, tasks.end());
        rebuild_tracker();
        save_tasks();
        return true;
    }

    std::vector<Task> get_tasks(int folder_id = -1, const std::string& type = "") const {
        std::vector<Task> out;
        for (const auto& t : tasks) {
            if (folder_id != -1 && t.folder_id != folder_id) continue;
            if (!type.empty() && t.type != type) continue;
            out.push_back(t);
        }
        return out;
    }

    // ── ANALYTICS ───────────────────────────
    json get_analytics() {
        rebuild_tracker();
        int total = (int)tasks.size();
        int done  = 0, in_prog = 0, pending = 0;
        int diary = 0;
        std::map<std::string, int> by_priority = {
            {"high", 0}, {"medium", 0}, {"low", 0}
        };

        for (const auto& t : tasks) {
            if (t.type == "diary") {
                diary++;
                continue;
            }
            if (t.status == "done")             done++;
            else if (t.status == "in_progress") in_prog++;
            else                                pending++;

            by_priority[t.priority]++;
        }

        int total_tasks = total - diary;
        int pct = total_tasks > 0 ? (int)(100.0 * done / total_tasks) : 0;

        return {
            {"total_tasks",         total_tasks},
            {"done",                done},
            {"in_progress",         in_prog},
            {"pending",             pending},
            {"diary_entries",       diary},
            {"completion_rate_pct", pct},
            {"by_priority",         by_priority},
            {"weekly",              tracker.to_json()}
        };
    }

private:
    void delete_folder_recursive(int id) {
        if (!folders.count(id)) return;
        std::vector<int> children = folders[id].children_ids;
        for (int cid : children) {
            delete_folder_recursive(cid);
        }
        tasks.erase(std::remove_if(tasks.begin(), tasks.end(),
            [id](const Task& t){ return t.folder_id == id; }), tasks.end());
        folders.erase(id);
    }

    void rebuild_tracker() {
        tracker.rebuild(tasks);
    }

    // ── PERSISTENCE ─────────────────────────
    void save_folders() {
        json arr = json::array();
        for (auto it = folders.begin(); it != folders.end(); ++it)
            arr.push_back(it->second.to_json());
        json root;
        root["next_id"] = next_folder_id;
        root["data"]    = arr;
        write_file(folder_file, root.dump(2));
    }

    void save_tasks() {
        json arr = json::array();
        for (const auto& t : tasks)
            arr.push_back(t.to_json());
        json root;
        root["next_id"] = next_task_id;
        root["data"]    = arr;
        write_file(task_file, root.dump(2));
    }

    void save_all() {
        save_folders();
        save_tasks();
    }

    void load_all() {
        // folders
        std::string fc = read_file(folder_file);
        if (!fc.empty()) {
            try {
                json root = json::parse(fc);
                next_folder_id = root.value("next_id", 1);
                for (const auto& j : root["data"]) {
                    Folder f = Folder::from_json(j);
                    folders[f.id] = f;
                }
            } catch (...) {}
        }
        // tasks
        std::string tc = read_file(task_file);
        if (!tc.empty()) {
            try {
                json root = json::parse(tc);
                next_task_id = root.value("next_id", 1);
                for (const auto& j : root["data"])
                    tasks.push_back(Task::from_json(j));
            } catch (...) {}
        }
        rebuild_tracker();
    }

    void seed_defaults_if_empty() {
        if (folders.empty()) {
            add_folder("📚 Study",    -1, "#6366f1");
            add_folder("💼 Work",     -1, "#f59e0b");
            add_folder("🏃 Personal", -1, "#10b981");
            add_folder("📓 Diary",    -1, "#ec4899");
        }

        if (tasks.empty()) {
            time_t now = time(nullptr);
            char buf[16];
            strftime(buf, sizeof(buf), "%Y-%m-%d", localtime(&now));
            std::string today(buf);

            add_task("Review DSA Graph Algorithms", "Practice BFS, DFS, and topological sort questions", today, 1, "task", "high", "done");
            add_task("Complete TaskFlow Code Audit", "Verify C++ models, weekly tracker calculations, and web UI", today, 2, "task", "high", "done");
            add_task("Plan Weekly Workout Schedule", "Cardio and strength training sessions", today, 3, "task", "medium", "pending");
            add_task("Today's Reflections & Learning", "Built an end-to-end full stack task tracker and diary in C++ and JavaScript. System architecture is robust and clean.", today, 4, "diary", "low", "done");
        }
    }

    // ── file helpers ─────────────────────────
    static std::string read_file(const std::string& path) {
        std::ifstream f(path);
        if (!f.is_open()) return "";
        std::stringstream ss;
        ss << f.rdbuf();
        return ss.str();
    }

    static void write_file(const std::string& path, const std::string& content) {
        std::ofstream f(path, std::ios::trunc);
        if (f.is_open()) f << content;
    }
};
