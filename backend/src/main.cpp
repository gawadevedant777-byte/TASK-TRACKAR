/*
 * ═══════════════════════════════════════════════════════════════
 *  TaskFlow — Task Tracker & Daily Diary C++ Backend
 *  HTTP Server: Raw WinSock2 (compatible with MinGW GCC 6+)
 *  JSON: nlohmann/json
 *  Port: 8080
 * ═══════════════════════════════════════════════════════════════
 */

#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include "../include/json.hpp"
#include "models.hpp"
#include "datastore.hpp"

#include <iostream>
#include <string>
#include <sstream>
#include <map>
#include <vector>
#include <algorithm>
#include <cstring>
#include <direct.h>

using json = nlohmann::json;

// ─── HTTP Request / Response structs ────────────────────────
struct HttpRequest {
    std::string method;
    std::string path;
    std::string query;
    std::string body;
    std::map<std::string, std::string> params;  // query params
};

struct HttpResponse {
    int status = 200;
    std::string content_type = "application/json";
    std::string body;
};

// ─── Helpers ─────────────────────────────────────────────────
static std::string url_decode(const std::string& s) {
    std::string out;
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i+2 < s.size()) {
            int hex;
            sscanf(s.substr(i+1, 2).c_str(), "%x", &hex);
            out += (char)hex;
            i += 2;
        } else if (s[i] == '+') {
            out += ' ';
        } else {
            out += s[i];
        }
    }
    return out;
}

static std::map<std::string, std::string> parse_query(const std::string& qs) {
    std::map<std::string, std::string> m;
    std::istringstream ss(qs);
    std::string token;
    while (std::getline(ss, token, '&')) {
        auto eq = token.find('=');
        if (eq != std::string::npos)
            m[url_decode(token.substr(0, eq))] = url_decode(token.substr(eq+1));
    }
    return m;
}

static HttpRequest parse_request(const std::string& raw) {
    HttpRequest req;
    std::istringstream ss(raw);
    std::string line;
    std::getline(ss, line);
    if (!line.empty() && line.back() == '\r') line.pop_back();

    // Method + path
    std::istringstream ls(line);
    ls >> req.method >> req.path;

    // Split path and query
    auto q = req.path.find('?');
    if (q != std::string::npos) {
        req.query  = req.path.substr(q+1);
        req.path   = req.path.substr(0, q);
        req.params = parse_query(req.query);
    }

    // Read headers until blank line
    int content_length = 0;
    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) break;
        auto col = line.find(':');
        if (col != std::string::npos) {
            std::string key = line.substr(0, col);
            std::string val = line.substr(col+1);
            while (!val.empty() && (val.front() == ' ' || val.front() == '\t')) val.erase(val.begin());
            std::transform(key.begin(), key.end(), key.begin(), ::tolower);
            if (key == "content-length") {
                try { content_length = std::stoi(val); } catch (...) {}
            }
        }
    }

    // Read body
    if (content_length > 0) {
        auto body_start = raw.find("\r\n\r\n");
        if (body_start != std::string::npos)
            req.body = raw.substr(body_start + 4, content_length);
    }
    return req;
}

static std::string status_text(int code) {
    switch(code) {
        case 200: return "OK";
        case 201: return "Created";
        case 400: return "Bad Request";
        case 404: return "Not Found";
        case 405: return "Method Not Allowed";
        case 500: return "Internal Server Error";
        default:  return "Unknown";
    }
}

static std::string build_response(const HttpResponse& res) {
    std::ostringstream out;
    out << "HTTP/1.1 " << res.status << " " << status_text(res.status) << "\r\n";
    out << "Content-Type: " << res.content_type << "; charset=utf-8\r\n";
    out << "Content-Length: " << res.body.size() << "\r\n";
    out << "Access-Control-Allow-Origin: *\r\n";
    out << "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n";
    out << "Access-Control-Allow-Headers: Content-Type\r\n";
    out << "Connection: close\r\n";
    out << "\r\n";
    out << res.body;
    return out.str();
}

static std::string read_file_str(const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return "";
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    std::string buf(sz, '\0');
    fread(&buf[0], 1, sz, f);
    fclose(f);
    return buf;
}

static std::string mime_for(const std::string& path) {
    if (path.size() > 5 && path.substr(path.size()-5) == ".html") return "text/html";
    if (path.size() > 4 && path.substr(path.size()-4) == ".css")  return "text/css";
    if (path.size() > 3 && path.substr(path.size()-3) == ".js")   return "application/javascript";
    if (path.size() > 4 && path.substr(path.size()-4) == ".ico")  return "image/x-icon";
    return "text/plain";
}

// ─── Route Handler ────────────────────────────────────────────
static HttpResponse handle(DataStore& db,
                           const HttpRequest& req,
                           const std::string& static_dir) {
    HttpResponse res;

    // ── CORS preflight ───────────────────────────────────────
    if (req.method == "OPTIONS") {
        res.body = "";
        res.content_type = "text/plain";
        return res;
    }

    // ── Static files ─────────────────────────────────────────
    if (req.method == "GET" && req.path.find("/api/") == std::string::npos) {
        std::string fpath = req.path;
        if (fpath == "/" || fpath.empty()) fpath = "/index.html";
        std::string full = static_dir + fpath;
        // Sanitize: reject path traversal
        if (full.find("..") != std::string::npos) {
            res.status = 400; res.body = "{}"; return res;
        }
        std::string content = read_file_str(full);
        if (content.empty()) {
            res.status = 404; res.body = "Not found";
            res.content_type = "text/plain";
            return res;
        }
        res.content_type = mime_for(full);
        res.body = content;
        return res;
    }

    // ── API routes ────────────────────────────────────────────
    try {

        // GET /api/health
        if (req.method == "GET" && req.path == "/api/health") {
            res.body = json{{"status","ok"},{"server","TaskFlow C++ Backend"}}.dump();
            return res;
        }

        // GET /api/folders
        if (req.method == "GET" && req.path == "/api/folders") {
            res.body = db.get_folders_tree().dump();
            return res;
        }

        // POST /api/folder
        if (req.method == "POST" && req.path == "/api/folder") {
            json body = json::parse(req.body);
            std::string name  = body.value("name",      "New Folder");
            int   parent_id   = body.value("parent_id", -1);
            std::string color = body.value("color",     "#6366f1");
            const Folder& f   = db.add_folder(name, parent_id, color);
            res.body = f.to_json().dump();
            return res;
        }

        // POST /api/folder/update or PUT /api/folder/:id
        if ((req.method == "POST" && req.path == "/api/folder/update") ||
            (req.method == "PUT"  && req.path.find("/api/folder/") == 0)) {
            json body = json::parse(req.body);
            int id = body.value("id", -1);
            if (id == -1 && req.path.find("/api/folder/") == 0 && req.path.size() > 12) {
                id = std::stoi(req.path.substr(12));
            }
            std::string name  = body.value("name", "");
            std::string color = body.value("color", "");
            int parent_id     = body.value("parent_id", -2);

            if (db.update_folder(id, name, color, parent_id))
                res.body = json{{"success", true}}.dump();
            else {
                res.status = 404;
                res.body   = json{{"error", "Folder not found"}}.dump();
            }
            return res;
        }

        // DELETE /api/folder/:id
        if (req.method == "DELETE" && req.path.find("/api/folder/") == 0) {
            int id = -1;
            if (req.path.size() > 12) {
                try { id = std::stoi(req.path.substr(12)); } catch (...) { id = -1; }
            }
            if (id > 0 && db.delete_folder(id)) {
                res.body = json{{"success", true}}.dump();
            } else {
                res.status = 404;
                res.body   = json{{"error","Folder not found"}}.dump();
            }
            return res;
        }

        // GET /api/tasks
        if (req.method == "GET" && req.path == "/api/tasks") {
            int folder_id = -1;
            std::string type = "";
            auto it = req.params.find("folder_id");
            if (it != req.params.end() && !it->second.empty()) {
                try { folder_id = std::stoi(it->second); } catch (...) { folder_id = -1; }
            }
            auto it_type = req.params.find("type");
            if (it_type != req.params.end()) {
                type = it_type->second;
            }
            auto tasks = db.get_tasks(folder_id, type);
            json arr = json::array();
            for (const auto& t : tasks) arr.push_back(t.to_json());
            res.body = arr.dump();
            return res;
        }

        // POST /api/task
        if (req.method == "POST" && req.path == "/api/task") {
            json body = json::parse(req.body);
            std::string title    = body.value("title",       "Untitled");
            std::string desc     = body.value("description", "");
            std::string date     = body.value("date",        "");
            int         fid      = body.value("folder_id",   -1);
            std::string type     = body.value("type",        "task");
            std::string priority = body.value("priority",    "medium");
            std::string status   = body.value("status",      "pending");

            if (date.empty()) {
                time_t now = time(NULL);
                char buf[16];
                strftime(buf, sizeof(buf), "%Y-%m-%d", localtime(&now));
                date = std::string(buf);
            }

            const Task& t = db.add_task(title, desc, date, fid, type, priority, status);
            res.body = t.to_json().dump();
            return res;
        }

        // POST /api/task/toggle
        if (req.method == "POST" && req.path == "/api/task/toggle") {
            json body = json::parse(req.body);
            int id    = body.value("id", -1);
            if (id > 0 && db.toggle_task(id)) {
                res.body = json{{"success", true}}.dump();
            } else {
                res.status = 404;
                res.body   = json{{"error","Task not found"}}.dump();
            }
            return res;
        }

        // POST /api/task/update or PUT /api/task/:id
        if ((req.method == "POST" && req.path == "/api/task/update") ||
            (req.method == "PUT"  && req.path.find("/api/task/") == 0)) {
            json body = json::parse(req.body);
            int id = body.value("id", -1);
            if (id == -1 && req.path.find("/api/task/") == 0 && req.path.size() > 10) {
                id = std::stoi(req.path.substr(10));
            }
            if (db.update_task(id, body))
                res.body = json{{"success", true}}.dump();
            else {
                res.status = 404;
                res.body   = json{{"error", "Task not found"}}.dump();
            }
            return res;
        }

        // DELETE /api/task/:id
        if (req.method == "DELETE" && req.path.find("/api/task/") == 0) {
            int id = -1;
            if (req.path.size() > 10) {
                try { id = std::stoi(req.path.substr(10)); } catch (...) { id = -1; }
            }
            if (id > 0 && db.delete_task(id)) {
                res.body = json{{"success", true}}.dump();
            } else {
                res.status = 404;
                res.body   = json{{"error","Task not found"}}.dump();
            }
            return res;
        }

        // GET /api/analytics
        if (req.method == "GET" && req.path == "/api/analytics") {
            res.body = db.get_analytics().dump();
            return res;
        }

        // 404
        res.status = 404;
        res.body   = json{{"error","Route not found"}}.dump();

    } catch (const std::exception& e) {
        res.status = 400;
        res.body   = json{{"error", e.what()}}.dump();
    }

    return res;
}

// ─── Main server loop ─────────────────────────────────────────
int main() {
    // Resolve absolute paths relative to server.exe location
    char exe_path[MAX_PATH];
    GetModuleFileNameA(NULL, exe_path, MAX_PATH);
    std::string exe_str(exe_path);
    for (char& c : exe_str) if (c == '\\') c = '/';

    std::string exe_dir    = exe_str.substr(0, exe_str.rfind('/'));  // <root>/backend
    std::string root_dir   = exe_dir.substr(0, exe_dir.rfind('/'));  // <root>
    std::string data_dir   = exe_dir + "/data";
    std::string static_dir = root_dir + "/frontend";

    _mkdir(data_dir.c_str());

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2,2), &wsa) != 0) {
        std::cerr << "WSAStartup failed\n";
        return 1;
    }

    DataStore db(data_dir);

    SOCKET srv_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (srv_sock == INVALID_SOCKET) {
        std::cerr << "socket() failed\n";
        return 1;
    }

    int opt = 1;
    setsockopt(srv_sock, SOL_SOCKET, SO_REUSEADDR, (char*)&opt, sizeof(opt));

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family      = AF_INET;
    addr.sin_port        = htons(8080);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(srv_sock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "bind() failed on port 8080. Is another server running?\n";
        closesocket(srv_sock);
        WSACleanup();
        return 1;
    }

    listen(srv_sock, 64);

    std::cout << "\n";
    std::cout << "╔═══════════════════════════════════════════════════╗\n";
    std::cout << "║    TaskFlow — Task Tracker & Daily Diary Server   ║\n";
    std::cout << "║    Available at: http://localhost:8080            ║\n";
    std::cout << "╚═══════════════════════════════════════════════════╝\n\n";
    std::cout << "[INFO] Data directory : " << data_dir   << "\n";
    std::cout << "[INFO] Static root    : " << static_dir << "\n";
    std::cout << "[INFO] Listening on port 8080 (Press Ctrl+C to stop)\n\n";

    while (true) {
        SOCKET client = accept(srv_sock, NULL, NULL);
        if (client == INVALID_SOCKET) continue;

        std::string raw;
        char buf[8192];
        int n;
        bool headers_done = false;
        int content_length = 0;
        size_t header_end = 0;

        while (true) {
            n = recv(client, buf, sizeof(buf)-1, 0);
            if (n <= 0) break;
            buf[n] = '\0';
            raw += buf;

            if (!headers_done) {
                header_end = raw.find("\r\n\r\n");
                if (header_end != std::string::npos) {
                    headers_done = true;
                    std::string hdrs = raw.substr(0, header_end);
                    std::string hdrs_lower = hdrs;
                    std::transform(hdrs_lower.begin(), hdrs_lower.end(), hdrs_lower.begin(), ::tolower);
                    auto cl_pos = hdrs_lower.find("content-length:");
                    if (cl_pos != std::string::npos) {
                        size_t val_start = cl_pos + 15;
                        while (val_start < hdrs.size() && (hdrs[val_start] == ' ' || hdrs[val_start] == '\t')) val_start++;
                        try {
                            content_length = std::stoi(hdrs.substr(val_start));
                        } catch (...) { content_length = 0; }
                    }
                }
            }

            if (headers_done) {
                int body_received = (int)raw.size() - (int)header_end - 4;
                if (body_received >= content_length) break;
            }
        }

        if (raw.empty()) {
            closesocket(client);
            continue;
        }

        HttpRequest  req = parse_request(raw);
        HttpResponse res = handle(db, req, static_dir);
        std::string  response = build_response(res);

        send(client, response.c_str(), (int)response.size(), 0);
        closesocket(client);

        std::cout << "[" << req.method << "] " << req.path
                  << " -> " << res.status << "\n";
    }

    closesocket(srv_sock);
    WSACleanup();
    return 0;
}
