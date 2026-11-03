// 05_aperiodic_comenzi - un task aperiodic care execută comenzi text
//
// loop() citește linii din Serial Monitor și pune fiecare linie, ca text, în
// coada de comenzi, fără să se blocheze (timeout 0). Așa face și
// command_received() cu comenzile venite prin MQTT. Elementul cozii conține
// textul însuși (un tablou char), nu un pointer: bufferul din loop() se
// refolosește pentru linia următoare.
//
// Fiecare comandă eliberează un job al taskului aperiodic, care o
// interpretează, modifică starea LED-ului (prin led_set, cu mutexul) și
// răspunde cu "OK ..." sau "ERROR ...". O comandă greșită nu oprește taskul.
//
// Un al doilea task, periodic (T = 50 ms), aplică starea pe LED.
//
// Comenzi (Serial Monitor cu „New Line” sau „Both NL & CR”):
//   LED ON | LED OFF    LED-ul aprins / stins
//   BLINK <ms>          LED-ul clipește, cu semiperioada <ms>, între 100 și 5000
//   STATUS              starea curentă
// Încercați și comenzi greșite: BLINK, BLINK 20, BLINK abc, LED, xyz.

const int LED_PIN = 8;  // LED-ul albastru: aprins pe LOW
const size_t kCommandMaxLen = 32;
const uint32_t kLedPeriodMs = 50;
const long kBlinkMinMs = 100;
const long kBlinkMaxMs = 5000;

enum LedMode { MODE_OFF, MODE_ON, MODE_BLINK };
const char* const MODE_NAMES[] = {"OFF", "ON", "BLINK"};

// Starea partajată de taskul aperiodic (scrie) și taskul periodic (citește).
// Se accesează doar prin led_set() și led_get(), care țin mutexul cât scriu
// sau copiază câmpurile, nu mai mult.
struct LedState {
    LedMode mode;
    uint32_t blink_ms;
};

static LedState g_led = {MODE_OFF, 500};
static SemaphoreHandle_t g_mutex = NULL;

static void led_set(LedMode mode, uint32_t blink_ms) {
    xSemaphoreTake(g_mutex, portMAX_DELAY);
    g_led.mode = mode;
    if (mode == MODE_BLINK) g_led.blink_ms = blink_ms;
    xSemaphoreGive(g_mutex);
}

static LedState led_get(void) {
    xSemaphoreTake(g_mutex, portMAX_DELAY);
    LedState copy = g_led;
    xSemaphoreGive(g_mutex);
    return copy;
}

struct Command {
    char text[kCommandMaxLen];
};
static QueueHandle_t g_commands = NULL;

static void command_task(void* arg) {
    (void)arg;
    for (;;) {
        Command c;
        xQueueReceive(g_commands, &c, portMAX_DELAY);  // blocat până sosește o comandă

        if (strcmp(c.text, "LED ON") == 0) {
            led_set(MODE_ON, 0);
            Serial.println("[comenzi] OK LED ON");
        } else if (strcmp(c.text, "LED OFF") == 0) {
            led_set(MODE_OFF, 0);
            Serial.println("[comenzi] OK LED OFF");
        } else if (strncmp(c.text, "BLINK ", 6) == 0) {
            long ms = atol(c.text + 6);  // 0 dacă nu este număr
            if (ms < kBlinkMinMs || ms > kBlinkMaxMs) {
                Serial.printf("[comenzi] ERROR BLINK: se așteaptă un număr între %ld și %ld\n", kBlinkMinMs, kBlinkMaxMs);
            } else {
                led_set(MODE_BLINK, ms);
                Serial.printf("[comenzi] OK BLINK %ld\n", ms);
            }
        } else if (strcmp(c.text, "STATUS") == 0) {
            LedState s = led_get();  // copia: afișăm fără mutexul luat
            Serial.printf("[comenzi] OK STATUS mod=%s blink=%lu\n", MODE_NAMES[s.mode], (unsigned long)s.blink_ms);
        } else {
            Serial.printf("[comenzi] ERROR comandă necunoscută: %s\n", c.text);
        }
    }
}

// Task periodic (T = kLedPeriodMs): la fiecare job copiază starea și o aplică
// pe LED. Clipirea se obține numărând joburile: la fiecare job se adună T, iar
// când suma ajunge la semiperioada blink_ms, LED-ul comută.
static void led_task(void* arg) {
    (void)arg;
    bool on = false;                          // LED-ul aprins sau stins acum
    uint32_t since_toggle_ms = 0;             // cât a trecut de la ultima comutare (BLINK)
    TickType_t last = xTaskGetTickCount();    // ultima eliberare, pentru grila r_k = r_0 + kT
    for (;;) {
        LedState s = led_get();  // copia stării, luată cu mutexul

        since_toggle_ms += kLedPeriodMs;  // a mai trecut o perioadă
        if (s.mode == MODE_ON) {
            on = true;
        } else if (s.mode == MODE_OFF) {
            on = false;
        } else if (since_toggle_ms >= s.blink_ms) {  // BLINK: s-a împlinit semiperioada
            on = !on;
            since_toggle_ms = 0;
        }
        digitalWrite(LED_PIN, on ? LOW : HIGH);  // LED-ul plăcii este aprins pe LOW
        xTaskDelayUntil(&last, pdMS_TO_TICKS(kLedPeriodMs));  // așteptare absolută: fără derivă
    }
}

// Pune o linie în coada de comenzi, ca command_received() din temă.
static void command_received(const char* text) {
    Command c;
    strncpy(c.text, text, sizeof(c.text) - 1);
    c.text[sizeof(c.text) - 1] = '\0';
    if (xQueueSend(g_commands, &c, 0) != pdTRUE) Serial.println("[loop] coada de comenzi plină");
}

void setup() {
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0);
    uint32_t t = millis();
    while (!Serial && millis() - t < 3000) delay(10);
    delay(200);
    Serial.println();
    Serial.println("=== tema 03, exemplul 05: aperiodic_comenzi ===");
    Serial.println("comenzi: LED ON, LED OFF, BLINK <ms>, STATUS");

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, HIGH);  // LED stins

    g_mutex = xSemaphoreCreateMutex();
    g_commands = xQueueCreate(5, sizeof(Command));

    xTaskCreate(command_task, "comenzi", 4096, NULL, 2, NULL);
    xTaskCreate(led_task, "led", 4096, NULL, 3, NULL);
}

void loop() {
    static char line[kCommandMaxLen];
    static size_t len = 0;
    while (Serial.available() > 0) {
        char ch = Serial.read();
        if (ch == '\n' || ch == '\r') {
            if (len > 0) {
                line[len] = '\0';
                command_received(line);
                len = 0;
            }
        } else if (len < sizeof(line) - 1) {
            line[len++] = ch;
        }
    }
    delay(20);
}
