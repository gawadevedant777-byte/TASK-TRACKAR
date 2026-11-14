#pragma once
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <ctime>
#include <cstdio>
#include <algorithm>
#include "../include/json.hpp"

using json = nlohmann::json;

// ─────────────────────────────────────────────
//  FOLDER  (N-ary tree node)
// ─────────────────────────────────────────────
struct Folder {
    int  id;
    int  parent_id;   // -1 means root
    std::string name;
    std::string color;   // hex colour for UI badges
    std::vector<int> children_ids;

    json to_json() const {
        return {
            {"id",           id},
            {"parent_id",    parent_id},
            {"name",         name},
            {"color",        color},
            {"children_ids", children_ids}
        };
    }

    static Folder from_json(const json& j) {
        Folder f;
        f.id          = j.value("id", 0);
        f.parent_id   = j.value("parent_id", -1);
        f.name        = j.value("name", "Untitled");
        f.color       = j.value("color", "#6366f1");
        f.children_ids = j.value("children_ids", std::vector<int>{});
        return f;
    }
};

// ─────────────────────────────────────────────
//  TASK / DIARY ENTRY
// ─────────────────────────────────────────────
struct Task {
    int         id;
    int         folder_id;
    std::string title;
    std::string description;
    std::string date;        // YYYY-MM-DD
    std::string status;      // "pending" | "in_progress" | "done"
    std::string type;        // "task" | "diary"
    std::string priority;    // "low" | "medium" | "high"
    int         created_at;  // unix timestamp

    json to_json() const {
        return {
            {"id",          id},
            {"folder_id",   folder_id},
            {"title",       title},
            {"description", description},
            {"date",        date},
            {"status",      status},
            {"type",        type},
            {"priority",    priority},
            {"created_at",  created_at}
        };
    }

    static Task from_json(const json& j) {
        Task t;
        t.id          = j.value("id", 0);
        t.folder_id   = j.value("folder_id", -1);
        t.title       = j.value("title", "");
        t.description = j.value("description", "");
        t.date        = j.value("date", "");
        t.status      = j.value("status", "pending");
        t.type        = j.value("type", "task");
        t.priority    = j.value("priority", "medium");
        t.created_at  = j.value("created_at", 0);
        return t;
    }
};

// ─────────────────────────────────────────────
//  WEEKLY TRACKER  (Mon-Sun tracking engine)
// ─────────────────────────────────────────────
struct DayStats {
    int total       = 0;
    int done        = 0;
    int in_progress = 0;
    int pending     = 0;
    std::string date = "";
};

struct WeeklyTracker {
    // key: "YYYY-MM-DD" of the Monday of that week
    // value: map of weekday (0=Mon … 6=Sun) -> DayStats
    std::map<std::string, std::map<int, DayStats>> weeks;
    std::string current_week_key = "";

    // Recompute from the full task list
    void rebuild(const std::vector<Task>& tasks) {
        weeks.clear();

        // 1. Determine current week's Monday key
        time_t now = time(nullptr);
        struct tm now_tm = *localtime(&now);
        int cur_wday = (now_tm.tm_wday + 6) % 7; // 0=Mon ... 6=Sun
        struct tm cur_mon = now_tm;
        cur_mon.tm_mday -= cur_wday;
        cur_mon.tm_hour = 12;
        cur_mon.tm_min  = 0;
        cur_mon.tm_sec  = 0;
        mktime(&cur_mon);

        char cur_key_buf[32];
        snprintf(cur_key_buf, sizeof(cur_key_buf), "%04d-%02d-%02d",
                 cur_mon.tm_year + 1900, cur_mon.tm_mon + 1, cur_mon.tm_mday);
        current_week_key = std::string(cur_key_buf);

        // Always initialize current week with all 7 days (Mon-Sun)
        init_week(current_week_key, cur_mon);

        // 2. Tally tasks
        for (const auto& t : tasks) {
            if (t.type != "task") continue;
            if (t.date.size() < 10) continue;

            int year = 0, month = 0, day = 0;
            if (sscanf(t.date.c_str(), "%d-%d-%d", &year, &month, &day) != 3) continue;

            struct tm tm_info = {};
            tm_info.tm_year = year - 1900;
            tm_info.tm_mon  = month - 1;
            tm_info.tm_mday = day;
            tm_info.tm_hour = 12; // Avoid DST boundaries
            if (mktime(&tm_info) == (time_t)-1) continue;

            // weekday: 0=Mon … 6=Sun  (tm_wday: 0=Sun, 1=Mon…)
            int wday = (tm_info.tm_wday + 6) % 7;

            // Find Monday of this date's week
            struct tm mon_tm = tm_info;
            mon_tm.tm_mday -= wday;
            mktime(&mon_tm);

            char week_buf[32];
            snprintf(week_buf, sizeof(week_buf), "%04d-%02d-%02d",
                     mon_tm.tm_year + 1900, mon_tm.tm_mon + 1, mon_tm.tm_mday);
            std::string week_key(week_buf);

            if (weeks.find(week_key) == weeks.end()) {
                init_week(week_key, mon_tm);
            }

            weeks[week_key][wday].total++;
            if (t.status == "done") {
                weeks[week_key][wday].done++;
            } else if (t.status == "in_progress") {
                weeks[week_key][wday].in_progress++;
            } else {
                weeks[week_key][wday].pending++;
            }
        }
    }

    void init_week(const std::string& week_key, const struct tm& mon_tm) {
        for (int d = 0; d < 7; ++d) {
            struct tm day_tm = mon_tm;
            day_tm.tm_mday += d;
            mktime(&day_tm);
            char d_buf[16];
            snprintf(d_buf, sizeof(d_buf), "%04d-%02d-%02d",
                     day_tm.tm_year + 1900, day_tm.tm_mon + 1, day_tm.tm_mday);
            weeks[week_key][d] = {0, 0, 0, 0, std::string(d_buf)};
        }
    }

    json to_json() const {
        json result = json::array();
        static const char* day_names[] = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"};
        static const char* month_names[] = {
            "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"
        };

        for (auto it = weeks.begin(); it != weeks.end(); ++it) {
            const std::string& week_key = it->first;
            const std::map<int, DayStats>& days = it->second;

            int week_total   = 0;
            int week_done    = 0;
            int week_in_prog = 0;
            int week_pending = 0;

            json day_arr = json::array();
            for (int d = 0; d < 7; d++) {
                int total = 0, done = 0, in_prog = 0, pending = 0;
                std::string d_date = "";
                auto dit = days.find(d);
                if (dit != days.end()) {
                    total   = dit->second.total;
                    done    = dit->second.done;
                    in_prog = dit->second.in_progress;
                    pending = dit->second.pending;
                    d_date  = dit->second.date;
                }
                week_total   += total;
                week_done    += done;
                week_in_prog += in_prog;
                week_pending += pending;

                json entry;
                entry["day"]         = day_names[d];
                entry["date"]        = d_date;
                entry["total"]       = total;
                entry["done"]        = done;
                entry["in_progress"] = in_prog;
                entry["pending"]     = pending;
                entry["pct"]         = total > 0 ? (int)(100.0 * done / total) : 0;
                day_arr.push_back(entry);
            }

            int week_pct = week_total > 0 ? (int)(100.0 * week_done / week_total) : 0;

            // Generate friendly label e.g. "Nov 02 - Nov 08, 2026"
            std::string label = week_key;
            int y = 0, m = 0, d = 0;
            if (sscanf(week_key.c_str(), "%d-%d-%d", &y, &m, &d) == 3) {
                struct tm s_tm = {};
                s_tm.tm_year = y - 1900;
                s_tm.tm_mon  = m - 1;
                s_tm.tm_mday = d;
                s_tm.tm_hour = 12;
                mktime(&s_tm);

                struct tm e_tm = s_tm;
                e_tm.tm_mday += 6;
                mktime(&e_tm);

                char lbuf[64];
                snprintf(lbuf, sizeof(lbuf), "%s %02d - %s %02d, %04d",
                         month_names[s_tm.tm_mon], s_tm.tm_mday,
                         month_names[e_tm.tm_mon], e_tm.tm_mday,
                         e_tm.tm_year + 1900);
                label = std::string(lbuf);
            }

            json wobj;
            wobj["week"]        = week_key;
            wobj["label"]       = label;
            wobj["is_current"]  = (week_key == current_week_key);
            wobj["total"]       = week_total;
            wobj["done"]        = week_done;
            wobj["in_progress"] = week_in_prog;
            wobj["pending"]     = week_pending;
            wobj["pct"]         = week_pct;
            wobj["days"]        = day_arr;
            result.push_back(wobj);
        }
        return result;
    }
};
