// 03_isr_coada - butonul BOOT, o rutină de întrerupere și o coadă
//
// Fiecare front descrescător pe GPIO9 (butonul BOOT, LOW cât timp e apăsat)
// declanșează rutina de întrerupere (ISR). ISR-ul notează momentul și pune un
// element în coadă cu xQueueSendFromISR(), atât. Un task preia elementele din
// coadă și le afișează pe Serial.
//
// Ce faceți: apăsați BOOT de câteva ori, scurt și apoi lung. La o singură
// apăsare apar adesea mai multe întreruperi, la câteva milisecunde distanță
// sau chiar în aceeași milisecundă: contactele butonului „sar” (bounce).
// Exemplul nu le filtrează, ca să le vedeți; filtrarea este în exemplul 04.
//
// Reguli pentru ISR:
//   - se declară cu IRAM_ATTR (codul stă în RAM, nu în flash)
//   - este scurt: fără Serial, fără mutex, fără așteptări
//   - folosește doar funcțiile FreeRTOS cu sufixul FromISR
//   - elementul cozii conține datele însele (aici, momentul), nu un pointer
//
// Nu țineți BOOT apăsat când apăsați RST: așa porniți bootloaderul, nu schița.

const int BUTTON_PIN = 9;

// Un element al cozii: momentul întreruperii, în ms de la pornire (din tick-uri).
// Un struct, ca să i se poată adăuga câmpuri (vezi exemplul 04).
struct Press {
    uint32_t at_ms;
};

static QueueHandle_t g_queue = NULL;

void IRAM_ATTR button_isr(void) {
    Press p = {(uint32_t)(xTaskGetTickCountFromISR() * portTICK_PERIOD_MS)};
    BaseType_t woken = pdFALSE;
    xQueueSendFromISR(g_queue, &p, &woken);
    portYIELD_FROM_ISR(woken);  // dacă a fost trezit un task mai prioritar, rulează imediat
}

static void press_task(void* arg) {
    (void)arg;
    uint32_t n = 0;
    uint32_t prev_ms = 0;
    for (;;) {
        Press p;
        xQueueReceive(g_queue, &p, portMAX_DELAY);  // blocat până sosește o întrerupere
        n = n + 1;
        uint32_t delta_ms = p.at_ms - prev_ms;
        prev_ms = p.at_ms;

        if (n == 1 || delta_ms > 1000) {  // o apăsare nouă: linie goală înainte
            Serial.printf("\n#%lu  t = %lu ms\n", (unsigned long)n, (unsigned long)p.at_ms);
        } else {
            Serial.printf("#%lu  t = %lu ms, la %lu ms după precedenta%s\n", (unsigned long)n,
                          (unsigned long)p.at_ms, (unsigned long)delta_ms, delta_ms < 50 ? "  <- bounce?" : "");
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
    Serial.println("=== tema 03, exemplul 03: isr_coada ===");
    Serial.println("apăsați butonul BOOT");

    pinMode(BUTTON_PIN, INPUT_PULLUP);
    g_queue = xQueueCreate(20, sizeof(Press));  // coada, înainte de ISR și de task

    xTaskCreate(press_task, "apasari", 4096, NULL, 3, NULL);
    attachInterrupt(digitalPinToInterrupt(BUTTON_PIN), button_isr, FALLING);  // la sfârșit
}

void loop() {
    delay(1000);
}
