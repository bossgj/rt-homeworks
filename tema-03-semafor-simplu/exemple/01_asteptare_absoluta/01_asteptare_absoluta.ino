// 01_asteptare_absoluta - un task periodic, cu așteptare absolută sau relativă
//
// Taskul are perioada T = 100 ms. La fiecare job notează momentul pornirii s_k
// și îl compară cu grila de eliberări r_k = r_0 + kT. Diferența este
// întârzierea L_k = s_k - r_k. Ca la un task real, fiecare job are un timp de
// calcul variabil, între 5 și 30 ms (simulat cu o buclă care ocupă procesorul).
//
//   așteptare absolută  xTaskDelayUntil(&last, T)  trezire la r_{k+1}, oricât a durat jobul
//   așteptare relativă  vTaskDelay(T)              trezire la T după sfârșitul jobului
//
// La fiecare 20 de joburi se afișează L minim, L maxim și jitterul
// J = max L_k - min L_k. Cu așteptarea absolută, L rămâne aproape de 0. Cu
// așteptarea relativă, fiecare job adaugă timpul lui de calcul la întârziere,
// iar L crește de la un raport la altul: aceasta este deriva.
//
// Taste (în Serial Monitor, urmate de Enter):
//   a  așteptare absolută (implicit)
//   r  așteptare relativă
// La fiecare schimbare, grila de eliberări pornește din nou de la k = 0.

const uint32_t kPeriodMs = 100;
const uint32_t kReportEvery = 20;  // joburi într-un raport
const uint32_t kMinWorkMs = 5;     // timpul de calcul simulat al unui job, între
const uint32_t kMaxWorkMs = 30;    // kMinWorkMs și kMaxWorkMs

static volatile bool g_absolute = true;  // setată din loop(); taskul repornește grila când se schimbă

// Timp de calcul simulat: ține procesorul ocupat ms milisecunde.
static void busy_ms(uint32_t ms) {
    uint32_t start = micros();
    while (micros() - start < ms * 1000) {
    }
}

static void periodic_task(void* arg) {
    (void)arg;
    bool absolute = !g_absolute;  // diferită de g_absolute: primul job pornește grila
    TickType_t last = 0;          // momentul ultimei eliberări, pentru xTaskDelayUntil
    uint32_t r0_us = 0;           // r_0, în microsecunde
    uint32_t k = 0;               // numărul jobului
    int32_t l_min = INT32_MAX, l_max = INT32_MIN;  // L minim și maxim din raportul curent

    for (;;) {
        if (absolute != g_absolute) {  // s-a schimbat modul: grila pornește din nou
            absolute = g_absolute;
            vTaskDelay(1);  // pornim grila exact la începutul unui tick
            last = xTaskGetTickCount();
            r0_us = micros();
            k = 0;
            l_min = INT32_MAX;
            l_max = INT32_MIN;
            Serial.printf("\n--- așteptare %s, T = %lu ms ---\n",
                          absolute ? "absolută (xTaskDelayUntil)" : "relativă (vTaskDelay)",
                          (unsigned long)kPeriodMs);
        }

        // s_k - r_k, cu r_k = r_0 + kT
        int32_t lateness_us = (int32_t)(micros() - (r0_us + k * kPeriodMs * 1000));
        l_min = min(l_min, lateness_us);
        l_max = max(l_max, lateness_us);
        if ((k + 1) % kReportEvery == 0) {  // la fiecare 20 de joburi: raport, apoi min/max de la zero
            Serial.printf("joburile %4lu-%4lu: L min %8.3f ms, L max %8.3f ms, jitter J %7.3f ms\n",
                          (unsigned long)(k + 1 - kReportEvery), (unsigned long)k, l_min / 1000.0,
                          l_max / 1000.0, (l_max - l_min) / 1000.0);
            l_min = INT32_MAX;
            l_max = INT32_MIN;
        }

        busy_ms(random(kMinWorkMs, kMaxWorkMs + 1));  // "lucrul" jobului
        k = k + 1;

        if (absolute) {
            xTaskDelayUntil(&last, pdMS_TO_TICKS(kPeriodMs));  // trezire la r_{k+1}
        } else {
            vTaskDelay(pdMS_TO_TICKS(kPeriodMs));  // trezire la T după acest moment
        }
    }
}

void setup() {
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0);
    uint32_t t = millis();
    while (!Serial && millis() - t < 3000) delay(10);
    delay(200);
    Serial.println();
    Serial.println("=== tema 03, exemplul 01: asteptare_absoluta ===");
    Serial.println("taste: a = așteptare absolută, r = așteptare relativă");

    // funcția, numele, stiva în octeți, argumentul, prioritatea, handle-ul
    xTaskCreate(periodic_task, "periodic", 4096, NULL, 2, NULL);
}

void loop() {
    // loop() citește tastele; taskul periodic face restul.
    while (Serial.available() > 0) {
        char c = Serial.read();
        if (c == 'a' || c == 'r') g_absolute = (c == 'a');
    }
    delay(50);
}
