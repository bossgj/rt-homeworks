# Dashboard-ul web, pentru serverul cursului (vezi compose.yml).
# Pentru temă nu aveți nevoie de el: rulați local cu  mvn -q compile exec:java

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src src
RUN mvn -q -B compile dependency:copy-dependencies -DincludeScope=runtime

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/classes classes
COPY --from=build /src/target/dependency lib
ENV HTTP_BIND=0.0.0.0 \
    HTTP_PORT=8080 \
    MULTI_STUDENT=true \
    TZ=Europe/Bucharest
EXPOSE 8080
USER nobody
CMD ["java", "-Djava.awt.headless=true", "-cp", "classes:lib/*", "ssatr.semafor.WebDashboard"]
