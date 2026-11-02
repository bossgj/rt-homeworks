package ssatr.semafor;

/**
 * Setările dashboard-ului web și numele topic-urilor MQTT.
 *
 * Brokerul este partajat de toți studenții. Înlocuiți STUDENT cu numele vostru
 * (fără spații sau diacritice), identic cu STUDENT din config.h al plăcii.
 */
public class Config {

    public static final String STUDENT = "popescu-ion";

    // Setările de mai jos se schimbă doar la instalarea pe serverul cursului
    // (variabile de mediu, vezi compose.yml). Local nu trebuie modificate.

    public static final String BROKER = env("BROKER", "tcp://control.aut.utcluj.ro:11188");

    /** brokerul afișat în pagină (pe server, BROKER este adresa internă) */
    public static final String BROKER_LABEL = env("BROKER_LABEL", BROKER.replace("tcp://", ""));

    /** portul paginii web: http://127.0.0.1:8080/ (schimbați-l dacă 8080 este ocupat) */
    public static final int HTTP_PORT = Integer.parseInt(env("HTTP_PORT", "8080"));

    /** adresa pe care ascultă serverul; 127.0.0.1 = doar de pe calculatorul vostru */
    public static final String HTTP_BIND = env("HTTP_BIND", "127.0.0.1");

    /**
     * true pe serverul cursului: dashboard-ul primește plăcile tuturor
     * studenților, iar fiecare pagină își alege studentul (?student=...).
     * false local: doar plăcile lui STUDENT.
     */
    public static final boolean MULTI_STUDENT = Boolean.parseBoolean(env("MULTI_STUDENT", "false"));

    /** topic-ul "lights" al unei plăci; student și deviceId pot fi "+" (oricare) */
    public static String lightsTopic(String student, String deviceId) {
        return "ssatr/" + student + "/devices/" + deviceId + "/lights";
    }

    /** comenzi de la dashboard către placă: "BUTTON" */
    public static String commandTopic(String student, String deviceId) {
        return "ssatr/" + student + "/devices/" + deviceId + "/commands";
    }

    private static String env(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
