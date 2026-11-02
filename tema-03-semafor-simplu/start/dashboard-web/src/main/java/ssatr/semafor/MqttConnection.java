package ssatr.semafor;

import java.util.concurrent.BlockingQueue;

import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

/**
 * Conexiunea la brokerul MQTT (aceeași clasă ca în temele 01 și 02, doar că
 * mesajele primite își păstrează și topic-ul, din care se află studentul).
 *
 * Mesajele primite nu sunt prelucrate pe thread-ul bibliotecii Paho, ci sunt
 * puse într-o coadă (BlockingQueue). Aplicația le preia din coadă pe
 * thread-urile ei, în ritmul ei.
 */
public class MqttConnection {

    /** Un mesaj primit: topic-ul și textul lui. */
    public record Message(String topic, String text) {
    }

    private final MqttClient client;

    public MqttConnection(String clientName) throws MqttException {
        // ID-ul clientului trebuie să fie unic pe broker
        String clientId = clientName + "-" + System.currentTimeMillis();
        client = new MqttClient(Config.BROKER, clientId, new MemoryPersistence());
    }

    public void connect() throws MqttException {
        MqttConnectOptions options = new MqttConnectOptions();
        options.setCleanSession(true);
        options.setAutomaticReconnect(true);
        client.connect(options);
        System.out.println("Conectat la " + Config.BROKER);
    }

    /** Publică un mesaj text (QoS 1). */
    public void publish(String topic, String text) {
        try {
            MqttMessage message = new MqttMessage(text.getBytes());
            message.setQos(1);
            client.publish(topic, message);
        } catch (MqttException e) {
            System.out.println("Eroare la publicare pe " + topic + ": " + e.getMessage());
        }
    }

    /**
     * Se abonează la un topic (poate conține wildcard-urile + și #).
     * Fiecare mesaj primit este pus în coada inbox, cu topic-ul lui.
     */
    public void subscribe(String topicFilter, BlockingQueue<Message> inbox) throws MqttException {
        client.subscribe(topicFilter, 1, (topic, message) -> inbox.put(new Message(topic, new String(message.getPayload()))));
        System.out.println("Abonat la " + topicFilter);
    }

    public void disconnect() throws MqttException {
        client.disconnect();
        client.close();
    }
}
