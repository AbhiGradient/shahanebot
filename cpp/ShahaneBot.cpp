#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>      // NEW: fmod, pow, isfinite
#include <iomanip>    // NEW: setprecision
#include <limits>

using namespace std;

// Stores one question-answer pair.
struct QAPair {
    string question;
    string answer;
};

// QABot manages the database and chat operations.
class QABot {
private:
    vector<QAPair> database;
    string filename;

    // Converts text to lowercase and replaces punctuation with spaces.
    string normalize(const string& text) const {
        string result;

        for (unsigned char ch : text) {
            if (isalnum(ch)) {
                result += static_cast<char>(tolower(ch));
            } else {
                result += ' ';
            }
        }

        return result;
    }

    // Splits normalized text into individual words.
    vector<string> tokenize(const string& text) const {
        vector<string> words;
        stringstream ss(normalize(text));
        string word;

        while (ss >> word) {
            words.push_back(word);
        }

        return words;
    }

    // Calculates the number of distinct query words that
    // also occur in the stored question.
    int calculateScore(const string& query,
                       const string& storedQuestion) const {
        vector<string> queryWords = tokenize(query);
        vector<string> questionWords = tokenize(storedQuestion);

        int score = 0;

        for (const string& word : queryWords) {
            if (find(questionWords.begin(),
                     questionWords.end(), word)
                != questionWords.end()) {
                ++score;
            }
        }

        return score;
    }

    // Common words that carry no topic information. They are ignored
    // when the bot looks for related Q&A entries.
    static bool isStopWord(const string& word) {
        static const char* const stopWords[] = {
            "a", "an", "the", "is", "are", "was", "were", "be", "what",
            "whats", "which", "who", "how", "why", "when", "where", "do",
            "does", "did", "of", "in", "on", "at", "to", "for", "with",
            "and", "or", "c", "cpp", "can", "you", "me", "tell", "about",
            "explain", "give", "please", "it", "its", "this", "that",
            "by", "as", "from", "i", "my", "difference", "between", "vs",
            "versus", "compare"
        };

        for (const char* stop : stopWords) {
            if (word == stop) {
                return true;
            }
        }

        return false;
    }

    // Very small stemmer: "classes" and "class" are treated alike
    // by dropping one trailing 's' from longer words.
    static string stem(const string& word) {
        if (word.size() > 3 && word.back() == 's' &&
            word[word.size() - 2] != 's') {
            return word.substr(0, word.size() - 1);
        }

        return word;
    }

    // Keeps only meaningful, stemmed words of a text.
    vector<string> significantWords(const string& text) const {
        vector<string> result;

        for (const string& word : tokenize(text)) {
            if (isStopWord(word)) {
                continue;
            }

            string root = stem(word);

            if (find(result.begin(), result.end(), root) == result.end()) {
                result.push_back(root);
            }
        }

        return result;
    }

    // Escapes text for use inside a JSON string literal.
    static string jsonEscape(const string& text) {
        string out;
        out.reserve(text.size() + 8);

        for (unsigned char ch : text) {
            switch (ch) {
                case '"':  out += "\\\""; break;
                case '\\': out += "\\\\"; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                case '\t': out += "\\t"; break;
                default:
                    if (ch < 0x20) {
                        char buffer[7];
                        snprintf(buffer, sizeof(buffer), "\\u%04x", ch);
                        out += buffer;
                    } else {
                        out += static_cast<char>(ch);
                    }
            }
        }

        return out;
    }

    // ---------------------------------------------------------
    // NEW: Arithmetic calculator
    // ---------------------------------------------------------

    // Recursive-descent parser for expressions such as
    // 2+2, (3+4)*5, -2^3, 10 % 3, 7/2.
    struct ExprParser {
        string s;
        size_t pos = 0;
        bool ok = true;       // false if the text is not a valid expression
        bool divZero = false; // true if division by zero occurred
        int ops = 0;          // number of binary operators used
        int depth = 0;        // parenthesis nesting depth

        explicit ExprParser(const string& text) : s(text) {}

        bool peek(char c) const { return pos < s.size() && s[pos] == c; }

        // expression := term (('+' | '-') term)*
        double parseExpr() {
            double v = parseTerm();
            while (ok && pos < s.size() && (s[pos] == '+' || s[pos] == '-')) {
                char op = s[pos++];
                double r = parseTerm();
                ++ops;
                v = (op == '+') ? v + r : v - r;
            }
            return v;
        }

        // term := unary (('*' | '/' | '%') unary)*
        double parseTerm() {
            double v = parseUnary();
            while (ok && pos < s.size() &&
                   (s[pos] == '*' || s[pos] == '/' || s[pos] == '%')) {
                char op = s[pos++];
                double r = parseUnary();
                ++ops;
                if (op == '*') {
                    v *= r;
                } else {
                    if (r == 0) {
                        divZero = true;
                        ok = false;
                        return 0;
                    }
                    v = (op == '/') ? v / r : fmod(v, r);
                }
            }
            return v;
        }

        // unary := ('-' | '+') unary | power
        double parseUnary() {
            if (!ok) return 0;
            if (peek('-')) { ++pos; return -parseUnary(); }
            if (peek('+')) { ++pos; return parseUnary(); }
            return parsePower();
        }

        // power := primary ('^' unary)?   (right associative)
        double parsePower() {
            double base = parsePrimary();
            if (ok && peek('^')) {
                ++pos;
                double e = parseUnary();
                ++ops;
                return pow(base, e);
            }
            return base;
        }

        // primary := number | '(' expression ')'
        double parsePrimary() {
            if (!ok) return 0;

            if (peek('(')) {
                if (++depth > 100) { ok = false; return 0; }
                ++pos;
                double v = parseExpr();
                if (!ok || !peek(')')) { ok = false; return 0; }
                ++pos;
                --depth;
                return v;
            }

            size_t start = pos;
            bool dot = false;
            while (pos < s.size() &&
                   (isdigit(static_cast<unsigned char>(s[pos])) ||
                    (s[pos] == '.' && !dot))) {
                if (s[pos] == '.') dot = true;
                ++pos;
            }

            if (pos == start || (dot && pos - start == 1)) {
                ok = false;
                return 0;
            }

            return stod(s.substr(start, pos - start));
        }
    };

    static void replaceAll(string& text, const string& from,
                           const string& to) {
        size_t p = 0;
        while ((p = text.find(from, p)) != string::npos) {
            text.replace(p, from.size(), to);
            p += to.size();
        }
    }

    // Prints whole numbers without decimals, others with up to
    // 10 significant digits.
    static string formatNumber(double v) {
        ostringstream out;
        if (fabs(v) < 1e15 && v == floor(v)) {
            out << static_cast<long long>(v);
        } else {
            out << setprecision(10) << v;
        }
        return out.str();
    }

    // Tries to treat the user's input as an arithmetic question.
    // Returns true (and fills 'output') only if it really was one.
    // Examples: "what is 2+2", "calculate (3+4)*5", "10 divided by 4",
    //           "5 plus 3", "2 power 10", "17 mod 5".
    bool tryCalculate(const string& input, string& output) const {
        string s = " " + input + " ";

        for (char& ch : s) {
            ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
        }

        // Turn word operators into symbols.
        replaceAll(s, "**", " ^ ");
        replaceAll(s, "\xC3\x97", " * ");   // multiplication sign
        replaceAll(s, "\xC3\xB7", " / ");   // division sign
        replaceAll(s, " plus ", " + ");
        replaceAll(s, " minus ", " - ");
        replaceAll(s, " times ", " * ");
        replaceAll(s, " multiplied by ", " * ");
        replaceAll(s, " x ", " * ");
        replaceAll(s, " divided by ", " / ");
        replaceAll(s, " over ", " / ");
        replaceAll(s, " modulo ", " % ");
        replaceAll(s, " mod ", " % ");
        replaceAll(s, " to the power of ", " ^ ");
        replaceAll(s, " raised to ", " ^ ");
        replaceAll(s, " power ", " ^ ");

        // Find the part of the text that could be the expression:
        // from the first digit or '(' to the last digit or ')'.
        size_t start = string::npos;
        size_t end = string::npos;

        for (size_t i = 0; i < s.size(); ++i) {
            unsigned char ch = static_cast<unsigned char>(s[i]);
            if (start == string::npos && (isdigit(ch) || ch == '(')) {
                start = i;
            }
            if (isdigit(ch) || ch == ')') {
                end = i;
            }
        }

        if (start == string::npos || end == string::npos || end < start) {
            return false;
        }

        // Keep a leading minus sign, e.g. "what is -5 + 3".
        if (start > 0 && s[start - 1] == '-') {
            --start;
        }

        string expr;
        for (size_t i = start; i <= end; ++i) {
            if (!isspace(static_cast<unsigned char>(s[i]))) {
                expr += s[i];
            }
        }

        double value = 0;
        bool divZero = false;

        try {
            ExprParser parser(expr);
            value = parser.parseExpr();
            divZero = parser.divZero;

            if (divZero) {
                output = "Cannot divide by zero.";
                return true;
            }

            // Must be fully consumed and contain at least one operator,
            // so plain numbers or "C++17" are left for the database.
            if (!parser.ok || parser.pos != expr.size() || parser.ops == 0) {
                return false;
            }
        } catch (...) {
            return false;
        }

        if (!isfinite(value)) {
            output = "That result is undefined or too large to display.";
            return true;
        }

        output = expr + " = " + formatNumber(value);
        return true;
    }

public:
    explicit QABot(const string& file)
        : filename(file) {
    }

    // Loads question-answer pairs from the database file.
    bool loadDatabase(bool verbose = true) {
        ifstream inputFile(filename.c_str());

        if (!inputFile.is_open()) {
            cerr << "Error: Could not open '" << filename
                 << "'. Make sure the file exists in the "
                    "current directory.\n";
            return false;
        }

        database.clear();

        string line;
        int lineNumber = 0;
        int skippedLines = 0;

        while (getline(inputFile, line)) {
            ++lineNumber;

            // Ignore empty or whitespace-only lines.
            if (line.find_first_not_of(" \t\r") == string::npos) {
                continue;
            }

            // Split at the first pipe character only.
            // This allows answers to contain additional pipes.
            size_t separator = line.find('|');

            if (separator == string::npos) {
                cerr << "Warning: Invalid format on line "
                     << lineNumber << ". Skipping.\n";
                ++skippedLines;
                continue;
            }

            string question = line.substr(0, separator);
            string answer = line.substr(separator + 1);

            // Remove leading and trailing whitespace.
            auto trim = [](string& text) {
                size_t first = text.find_first_not_of(" \t\r\n");

                if (first == string::npos) {
                    text.clear();
                    return;
                }

                size_t last = text.find_last_not_of(" \t\r\n");
                text = text.substr(first, last - first + 1);
            };

            trim(question);
            trim(answer);

            if (question.empty() || answer.empty()) {
                cerr << "Warning: Empty question or answer on line "
                     << lineNumber << ". Skipping.\n";
                ++skippedLines;
                continue;
            }

            QAPair pair;
            pair.question = question;
            pair.answer = answer;

            database.push_back(pair);
        }

        if (inputFile.bad()) {
            cerr << "Error: A problem occurred while reading '"
                 << filename << "'.\n";
            database.clear();
            return false;
        }

        inputFile.close();

        if (verbose) {
            cout << "Database loaded successfully: "
                 << database.size() << " Q&A pairs.\n";

            if (skippedLines > 0) {
                cout << "Warning: " << skippedLines
                     << " invalid line(s) were skipped.\n";
            }
        } else if (skippedLines > 0) {
            cerr << "Warning: " << skippedLines
                 << " invalid line(s) were skipped.\n";
        }

        return true;
    }

    // Returns the index of the answer with the highest word overlap,
    // or -1 when nothing matches.
    int findBestMatch(const string& query) const {
        if (database.empty()) {
            return -1;
        }

        int bestScore = 0;
        size_t bestIndex = 0;

        for (size_t i = 0; i < database.size(); ++i) {
            int score = calculateScore(query, database[i].question);

            // Keep the first result when scores are tied.
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }

        // Require at least one matching word.
        if (bestScore == 0) {
            return -1;
        }

        return static_cast<int>(bestIndex);
    }

    // Finds and displays the answer with the highest word overlap.
    void askQuestion(const string& query) const {
        string calcResult;  // NEW: arithmetic questions like "what is 2+2"

        if (tryCalculate(query, calcResult)) {
            cout << "Shahane Bot: " << calcResult << '\n';
            return;
        }

        int match = findBestMatch(query);

        if (match < 0) {
            cout << "No relevant answer found.\n";
            return;
        }

        cout << "Shahane Bot: "
             << database[static_cast<size_t>(match)].answer << '\n';
    }

    // One related Q&A entry found by searchTop().
    struct Match {
        size_t index;
        int matched;       // significant query words found in the question
        double coverage;   // matched / significant words in the query
    };

    // Returns up to 'limit' stored entries that share meaningful words
    // with the query, best first. Used by the web backend to give the
    // AI model some supplementary notes from the text file.
    vector<Match> searchTop(const string& query, size_t limit) const {
        vector<Match> found;
        vector<string> queryWords = significantWords(query);

        if (queryWords.empty()) {
            return found;
        }

        for (size_t i = 0; i < database.size(); ++i) {
            vector<string> questionWords =
                significantWords(database[i].question);
            int matched = 0;

            for (const string& word : queryWords) {
                if (find(questionWords.begin(), questionWords.end(), word)
                    != questionWords.end()) {
                    ++matched;
                }
            }

            double coverage =
                static_cast<double>(matched) / queryWords.size();

            // Require at least half of the query's topic words to match.
            if (matched >= 1 && coverage >= 0.5) {
                found.push_back(Match{i, matched, coverage});
            }
        }

        stable_sort(found.begin(), found.end(),
                    [](const Match& a, const Match& b) {
                        if (a.matched != b.matched) {
                            return a.matched > b.matched;
                        }
                        return a.coverage > b.coverage;
                    });

        if (found.size() > limit) {
            found.resize(limit);
        }

        return found;
    }

    // Lists all stored questions.
    void listQuestions() const {
        if (database.empty()) {
            cout << "The database contains no Q&A pairs.\n";
            return;
        }

        cout << "\n--- Available Questions ---\n";

        for (size_t i = 0; i < database.size(); ++i) {
            cout << i + 1 << ". "
                 << database[i].question << '\n';
        }

        cout << "---------------------------\n";
        cout << "Total: " << database.size() << " questions\n";
    }

    // Line-oriented JSON protocol used by the web backend.
    // Commands: ASK <text>, CALC <text>, SEARCH <n> <text>, LIST, PING, QUIT.
    // One JSON object per reply.
    void serve() const {
        cout << "{\"type\":\"ready\",\"count\":" << database.size()
             << "}" << endl;

        string line;

        while (getline(cin, line)) {
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }

            if (line == "QUIT") {
                break;
            } else if (line == "PING") {
                cout << "{\"type\":\"pong\",\"count\":"
                     << database.size() << "}" << endl;
            } else if (line == "LIST") {
                cout << "{\"type\":\"questions\",\"questions\":[";

                for (size_t i = 0; i < database.size(); ++i) {
                    if (i > 0) {
                        cout << ',';
                    }
                    cout << '"' << jsonEscape(database[i].question) << '"';
                }

                cout << "]}" << endl;
            } else if (line.compare(0, 5, "CALC ") == 0) {
                string calcResult;

                if (tryCalculate(line.substr(5), calcResult)) {
                    cout << "{\"type\":\"calc\",\"found\":true,"
                         << "\"answer\":\"" << jsonEscape(calcResult)
                         << "\"}" << endl;
                } else {
                    cout << "{\"type\":\"calc\",\"found\":false}" << endl;
                }
            } else if (line.compare(0, 7, "SEARCH ") == 0) {
                // Format: SEARCH <limit> <text>
                string rest = line.substr(7);
                size_t space = rest.find(' ');
                size_t limit = 3;
                string query = rest;

                if (space != string::npos) {
                    int parsed = atoi(rest.substr(0, space).c_str());
                    if (parsed > 0 && parsed <= 10) {
                        limit = static_cast<size_t>(parsed);
                    }
                    query = rest.substr(space + 1);
                }

                vector<Match> matches = searchTop(query, limit);

                cout << "{\"type\":\"matches\",\"matches\":[";

                for (size_t i = 0; i < matches.size(); ++i) {
                    const QAPair& pair = database[matches[i].index];
                    char coverage[16];
                    snprintf(coverage, sizeof(coverage), "%.2f",
                             matches[i].coverage);

                    if (i > 0) {
                        cout << ',';
                    }

                    cout << "{\"question\":\"" << jsonEscape(pair.question)
                         << "\",\"answer\":\"" << jsonEscape(pair.answer)
                         << "\",\"matched\":" << matches[i].matched
                         << ",\"coverage\":" << coverage << "}";
                }

                cout << "]}" << endl;
            } else if (line.compare(0, 4, "ASK ") == 0) {
                string query = line.substr(4);
                string calcResult;  // NEW: arithmetic questions

                if (tryCalculate(query, calcResult)) {
                    cout << "{\"type\":\"answer\",\"found\":true,"
                         << "\"answer\":\"" << jsonEscape(calcResult)
                         << "\"}" << endl;
                    continue;
                }

                int match = findBestMatch(query);

                if (match < 0) {
                    cout << "{\"type\":\"answer\",\"found\":false,"
                         << "\"answer\":\"No relevant answer found.\"}"
                         << endl;
                } else {
                    cout << "{\"type\":\"answer\",\"found\":true,"
                         << "\"answer\":\""
                         << jsonEscape(
                                database[static_cast<size_t>(match)].answer)
                         << "\"}" << endl;
                }
            } else {
                cout << "{\"type\":\"error\",\"message\":"
                     << "\"Unknown command\"}" << endl;
            }
        }
    }

    // Displays available commands.
    void showHelp() const {
        cout << "\n--- Shahane Bot Help ---\n"
             << "Ask a question : Enter any C++ question\n"
             << "Calculate      : Ask e.g. what is 2+2, (3+4)*5, 10 divided by 4\n"  // NEW
             << "help           : Display this help message\n"
             << "list           : List stored questions\n"
             << "quit / exit    : Close the bot\n"
             << "------------------------\n";
    }

    // Starts the interactive chat loop.
    void startChat() const {
        string input;

        cout << "\n====================================\n"
             << "       Welcome to Shahane Bot!\n"
             << "====================================\n"
             << "Loaded Q&A pairs: " << database.size() << '\n'
             << "Type 'help' for commands or 'quit' to exit.\n";

        while (true) {
            cout << "\nYou: ";

            if (!getline(cin, input)) {
                cout << "\nShahane Bot: Input ended. Goodbye!\n";
                break;
            }

            // Normalize commands for case-insensitive matching.
            string command = normalize(input);

            // Remove leading/trailing spaces from the command.
            size_t first = command.find_first_not_of(' ');
            if (first == string::npos) {
                continue;
            }

            size_t last = command.find_last_not_of(' ');
            command = command.substr(first, last - first + 1);

            if (command == "quit" || command == "exit") {
                cout << "Shahane Bot: Goodbye! Have a great day.\n";
                break;
            } else if (command == "help") {
                showHelp();
            } else if (command == "list") {
                listQuestions();
            } else {
                askQuestion(input);
            }
        }
    }
};

int main(int argc, char* argv[]) {
    string databasePath = "qa_database.txt";
    bool serverMode = false;

    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--server") == 0) {
            serverMode = true;
        } else if (strcmp(argv[i], "--db") == 0 && i + 1 < argc) {
            databasePath = argv[++i];
        } else {
            cerr << "Usage: " << argv[0]
                 << " [--db <file>] [--server]\n";
            return 2;
        }
    }

    QABot bot(databasePath);

    // Stop if the database cannot be loaded.
    if (!bot.loadDatabase(!serverMode)) {
        return 1;
    }

    if (serverMode) {
        bot.serve();
    } else {
        bot.startChat();
    }

    return 0;
}