package ssatr.semafor;

import java.awt.Desktop;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * Dashboard-ul web al trecerii de pietoni (aplicație gata implementată).
 *
 * Rulare:  mvn -q compile exec:java   apoi deschideți http://127.0.0.1:8080/
 *
 * Un browser nu se poate conecta direct la brokerul MQTT (TCP), așa că
 * aplicația aceasta face doar legătura dintre broker și pagina web:
 *  - mesajele "lights" primite de la plăci sunt trimise paginii (Server-Sent Events);
 *  - butonul din pagină ajunge aici și este publicat ca BUTTON pe topic-ul "commands".
 *
 * Tot ce se vede (lămpile, mașinile, pietonii, verificările de siguranță) este
 * în pagină: src/main/resources/web/. Ca și în dashboard-ul Swing, lămpile se
 * aprind doar după mesajele plăcii; dashboard-ul nu ia nicio decizie.
 *
 * Pe serverul cursului rulează cu MULTI_STUDENT=true (vezi Config): primește
 * plăcile tuturor studenților și fiecare pagină le vede doar pe ale studentului ei.
 */
public class WebDashboard {

    /** numele studenților și ale plăcilor, așa cum apar în topic-uri */
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9_.-]{1,40}");

    /** câte pagini pot fi deschise în același timp */
    private static final int MAX_PAGES = 500;

    /** fișierele paginii, din src/main/resources/web/, cu tipul lor */
    private static final Map<String, String> FILES = Map.of(
            "index.html", "text/html; charset=utf-8",
            "style.css", "text/css; charset=utf-8",
            "dashboard.js", "text/javascript; charset=utf-8",
            "intersectie.js", "text/javascript; charset=utf-8");

    /** o pagină deschisă, care primește mesajele "lights" ale unui student */
    private record Page(OutputStream out, String student) {
    }

    private final MqttConnection mqtt;
    private final List<Page> pages = new CopyOnWriteArrayList<>();

    public WebDashboard(MqttConnection mqtt) {
        this.mqtt = mqtt;
    }

    public static void main(String[] args) throws Exception {
        MqttConnection mqtt = new MqttConnection(
                Config.MULTI_STUDENT ? "semafor-web" : Config.STUDENT + "-semafor-web");
        mqtt.connect();

        BlockingQueue<MqttConnection.Message> lightsInbox = new LinkedBlockingQueue<>();
        // "+" înseamnă "orice device" (și, pe server, "orice student")
        mqtt.subscribe(Config.lightsTopic(Config.MULTI_STUDENT ? "+" : Config.STUDENT, "+"), lightsInbox);

        WebDashboard dashboard = new WebDashboard(mqtt);
        dashboard.startHttp();

        String url = "http://" + Config.HTTP_BIND + ":" + Config.HTTP_PORT + "/";
        System.out.println("Dashboard-ul web: " + url);
        if (!Config.MULTI_STUDENT) {
            openBrowser(url);
        }

        // Mesajele se preiau din coadă pe thread-ul principal și se trimit paginilor.
        while (true) {
            MqttConnection.Message m = lightsInbox.take();
            // ssatr/<student>/devices/<deviceId>/lights
            String[] parts = m.topic().split("/");
            if (parts.length == 5) {
                dashboard.broadcast(parts[1], event("lights", m.text()));
            }
        }
    }

    // ---------------------------------------------------------------- server HTTP

    private void startHttp() throws IOException {
        HttpServer server;
        try {
            // implicit doar pe calculatorul local: pagina poate trimite comenzi plăcii
            server = HttpServer.create(new InetSocketAddress(InetAddress.getByName(Config.HTTP_BIND), Config.HTTP_PORT), 0);
        } catch (BindException e) {
            throw new IOException("portul " + Config.HTTP_PORT + " este ocupat; schimbați HTTP_PORT în Config.java", e);
        }
        server.createContext("/", this::serveFile);
        server.createContext("/api/events", this::serveEvents);
        server.createContext("/api/button", this::serveButton);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();

        // un comentariu la 15 s ține deschisă conexiunea paginilor când nu vin mesaje
        Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "keepalive");
            t.setDaemon(true);
            return t;
        }).scheduleAtFixedRate(() -> broadcast(null, ": keepalive\n\n"), 15, 15, TimeUnit.SECONDS);
    }

    /** GET /, /style.css, ...: fișierele paginii. */
    private void serveFile(HttpExchange ex) throws IOException {
        String name = ex.getRequestURI().getPath().substring(1);
        if (name.isEmpty()) {
            name = "index.html";
        }
        String type = FILES.get(name);
        try (ex; InputStream in = type == null ? null : WebDashboard.class.getResourceAsStream("/web/" + name)) {
            if (in == null) {
                reply(ex, 404, "nu există: " + name);
                return;
            }
            byte[] body = in.readAllBytes();
            ex.getResponseHeaders().set("Content-Type", type);
            ex.getResponseHeaders().set("Cache-Control", "no-store");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
        }
    }

    /**
     * GET /api/events (pe server: /api/events?student=popescu-ion): fluxul de
     * mesaje către pagină (Server-Sent Events); conexiunea rămâne deschisă.
     */
    private void serveEvents(HttpExchange ex) throws IOException {
        if (pages.size() >= MAX_PAGES) {
            try (ex) {
                reply(ex, 503, "prea multe pagini deschise");
            }
            return;
        }
        // fără student valid (doar pe server), pagina primește doar config-ul, cu student "",
        // și le cere numele studentului
        String student = studentOf(ex);
        ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ex.getResponseHeaders().set("Cache-Control", "no-store");
        ex.sendResponseHeaders(200, 0);
        OutputStream out = ex.getResponseBody();
        String config = String.format("{\"student\":\"%s\",\"multi\":%b,\"broker\":\"%s\",\"topic\":\"%s\"}",
                student == null ? "" : student, Config.MULTI_STUDENT, Config.BROKER_LABEL,
                student == null ? "" : Config.lightsTopic(student, "+"));
        if (send(out, event("config", config))) {
            if (student == null) {
                ex.close();
            } else {
                pages.add(new Page(out, student));
            }
        }
    }

    /** POST /api/button?device=esp32-a1b2c3 (pe server și &student=...): publică BUTTON pe topic-ul de comenzi al plăcii. */
    private void serveButton(HttpExchange ex) throws IOException {
        try (ex) {
            if (!ex.getRequestMethod().equals("POST")) {
                reply(ex, 405, "doar POST");
                return;
            }
            String student = studentOf(ex);
            String device = queryParam(ex.getRequestURI().getRawQuery(), "device");
            if (student == null || device == null || !NAME.matcher(device).matches()) {
                reply(ex, 400, "student sau device lipsă sau invalid");
                return;
            }
            mqtt.publish(Config.commandTopic(student, device), "BUTTON");
            ex.sendResponseHeaders(204, -1);
        }
    }

    /** Studentul paginii: local, STUDENT din Config; pe server, parametrul student. null = invalid. */
    private static String studentOf(HttpExchange ex) {
        if (!Config.MULTI_STUDENT) {
            return Config.STUDENT;
        }
        String student = queryParam(ex.getRequestURI().getRawQuery(), "student");
        return student != null && NAME.matcher(student).matches() ? student : null;
    }

    // ---------------------------------------------------------------- trimiterea către pagini

    /** Trimite text paginilor studentului dat (null = tuturor). */
    private void broadcast(String student, String text) {
        for (Page page : pages) {
            if ((student == null || student.equals(page.student())) && !send(page.out(), text)) {
                pages.remove(page);
            }
        }
    }

    /** Un eveniment SSE; mesajul se pune pe o singură linie. */
    private static String event(String name, String data) {
        return "event: " + name + "\ndata: " + data.replace('\r', ' ').replace('\n', ' ') + "\n\n";
    }

    /** @return false dacă pagina s-a închis */
    private static boolean send(OutputStream out, String text) {
        synchronized (out) {
            try {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                out.flush();
                return true;
            } catch (IOException e) {
                try {
                    out.close();
                } catch (IOException ignored) {
                    // pagina e deja închisă
                }
                return false;
            }
        }
    }

    private static void reply(HttpExchange ex, int status, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        ex.sendResponseHeaders(status, body.length);
        ex.getResponseBody().write(body);
    }

    private static String queryParam(String query, String name) {
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                return URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private static void openBrowser(String url) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(url));
            }
        } catch (Exception | Error e) {
            // fără browser deschis automat: adresa e afișată mai sus
        }
    }
}
