// 06_automat_doua_periodice - un automat cu stări și două taskuri periodice
//
// O barieră de parcare: stă închisă până sosește o mașină, apoi se ridică,
// rămâne ridicată un timp și coboară la loc.
//
//   CLOSED  --(cerere)--------->  OPENING
//   OPENING --(după 3 s)------->  OPEN      aici se șterge cererea: mașina poate trece
//   OPEN    --(după 5 s)------->  CLOSING
//   CLOSING --(după 3 s)------->  CLOSED
//
// Două taskuri periodice, cu perioade diferite, comunică doar prin starea
// barierei, protejată de un mutex:
//
//   control  T = 100 ms   decide starea (automatul de mai sus); nu afișează nimic
//                         în afară de schimbările de stare
//   ieșire   T = 500 ms   decide ce se vede: LED-ul și o linie pe Serial
//
// Ce se vede: CLOSED = LED stins, OPEN = LED aprins, OPENING și CLOSING = LED
// intermitent. Intermitența vine din taskul de ieșire: aprins la un job,
// stins la următorul, deci cu perioada taskului. Linia de ieșire arată și
// câte secunde mai durează starea curentă, rotunjite în sus.
//
// Durata unei stări se măsoară cu millis(), un timp monoton: momentul intrării
// în stare se păstrează în starea partajată.
//
// Taste (în Serial Monitor, urmate de Enter):
//   m  sosește o mașină (cererea). O cerere venită cât bariera e ridicată
//      rămâne înregistrată și ridică bariera din nou după ce coboară.

const int LED_PIN = 8;  // LED-ul albastru: aprins pe LOW
const uint32_t kControlPeriodMs = 100;
const uint32_t kOutputPeriodMs = 500;
const uint32_t kOpeningMs = 3000;
const uint32_t kOpenMs = 5000;
const uint32_t kClosingMs = 3000;

enum Phase { CLOSED, OPENING, OPEN, CLOSING };
const char* const PHASE_NAMES[] = {"CLOSED", "OPENING", "OPEN", "CLOSING"};
const uint32_t PHASE_MS[] = {0, kOpeningMs, kOpenMs, kClosingMs};  // durata stării; 0 = până la un eveniment

struct Barrier {
    Phase phase;
    uint32_t phase_start_ms;  // millis() la intrarea în starea curentă
    bool request;             // a sosit o mașină
};

static Barrier g_barrier = {CLOSED, 0, false};
static SemaphoreHandle_t g_mutex = NULL;

static void control_task(void* arg) {
    (void)arg;
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        uint32_t now = millis();
        xSemaphoreTake(g_mutex, portMAX_DELAY);
        Phase before = g_barrier.phase;
        uint32_t elapsed = now - g_barrier.phase_start_ms;
        Phase next = before;
        switch (before) {
            case CLOSED:
                if (g_barrier.request) next = OPENING;
                break;
            case OPENING:
                if (elapsed >= kOpeningMs) next = OPEN;
                break;
            case OPEN:
                if (elapsed >= kOpenMs) next = CLOSING;
                break;
            case CLOSING:
                if (elapsed >= kClosingMs) next = CLOSED;
                break;
        }
        if (next != before) {
            g_barrier.phase = next;
            g_barrier.phase_start_ms = now;
            if (next == OPEN) g_barrier.request = false;
        }
        xSemaphoreGive(g_mutex);

        // Serial după ce am eliberat mutexul
        if (next != before) Serial.printf("[control] %s -> %s\n", PHASE_NAMES[before], PHASE_NAMES[next]);
        xTaskDelayUntil(&last, pdMS_TO_TICKS(kControlPeriodMs));
    }
}

static void output_task(void* arg) {
    (void)arg;
    bool blink_on = true;
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        uint32_t now = millis();
        xSemaphoreTake(g_mutex, portMAX_DELAY);
        Barrier b = g_barrier;  // copia stării, cu mutexul luat cât mai puțin
        xSemaphoreGive(g_mutex);

        bool led = false;
        switch (b.phase) {
            case CLOSED: led = false; break;
            case OPEN: led = true; break;
            default: led = blink_on; break;  // OPENING, CLOSING: intermitent
        }
        blink_on = !blink_on;  // alternează de la un job la altul
        digitalWrite(LED_PIN, led ? LOW : HIGH);

        // Secundele rămase din starea curentă, rotunjite în sus; 0 în CLOSED, care nu are durată
        uint32_t duration = PHASE_MS[b.phase];
        uint32_t seconds = 0;
        if (duration > 0) {
            uint32_t elapsed = min(now - b.phase_start_ms, duration);
            seconds = (duration - elapsed + 999) / 1000;
        }
        Serial.printf("[iesire]  %-7s LED %-6s cerere %d  rămas %lu s\n", PHASE_NAMES[b.phase], led ? "aprins" : "stins",
                      b.request ? 1 : 0, (unsigned long)seconds);
        xTaskDelayUntil(&last, pdMS_TO_TICKS(kOutputPeriodMs));
    }
}

void setup() {
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0);
    uint32_t t = millis();
    while (!Serial && millis() - t < 3000) delay(10);
    delay(200);
    Serial.println();
    Serial.println("=== tema 03, exemplul 06: automat_doua_periodice ===");
    Serial.println("tasta: m = sosește o mașină");

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH);  // LED stins

    g_mutex = xSemaphoreCreateMutex();
    g_barrier.phase_start_ms = millis();

    // Controlul este mai prioritar: perioada lui e mai mică.
    xTaskCreate(control_task, "control", 4096, NULL, 3, NULL);
    xTaskCreate(output_task, "iesire", 4096, NULL, 2, NULL);
}

void loop() {
    while (Serial.available() > 0) {
        if (Serial.read() == 'm') {
            xSemaphoreTake(g_mutex, portMAX_DELAY);
            g_barrier.request = true;
            xSemaphoreGive(g_mutex);
            Serial.println("[loop]    mașină sosită: cerere înregistrată");
        }
    }
    delay(20);
}
