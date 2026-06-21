#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

const int SERVO_COUNT = 16;
const int ACTIVE_SERVO_COUNT = 6;
const int DEFAULT_RETURN_ANGLE = 90;
const int DEFAULT_STRIKE_ANGLE = 35;
const int DEFAULT_DWELL_MS = 10;
const int DEFAULT_STEP_DELAY_MS = 0;

// Tune these if your servos do not reach the expected angles.
const int SERVO_MIN_PULSE = 120;
const int SERVO_MAX_PULSE = 620;
const int SERVO_FREQ = 50;

struct ServoConfig {
  int returnAngle;
  int strikeAngle;
  int dwellMs;
  int stepDelayMs;
  int currentAngle;
  int targetAngle;
  unsigned long lastStepAtMs;
  unsigned long returnAtMs;
  bool strikeActive;
};

ServoConfig servos[SERVO_COUNT];
String inputLine = "";

String nextToken(String &line);

int angleToPulse(int angle) {
  int safeAngle = constrain(angle, 0, 180);
  return map(safeAngle, 0, 180, SERVO_MIN_PULSE, SERVO_MAX_PULSE);
}

void writeServoAngle(int servo, int angle) {
  if (servo < 0 || servo >= SERVO_COUNT) {
    return;
  }

  pwm.setPWM(servo, 0, angleToPulse(angle));
  servos[servo].currentAngle = constrain(angle, 0, 180);
}

void setServoTarget(int servo, int targetAngle) {
  if (servo < 0 || servo >= SERVO_COUNT) {
    return;
  }

  int safeTarget = constrain(targetAngle, 0, 180);
  servos[servo].targetAngle = safeTarget;

  if (servos[servo].stepDelayMs == 0) {
    writeServoAngle(servo, safeTarget);
  }
}

void updateServo(int servo, unsigned long now) {
  if (servos[servo].strikeActive && (long)(now - servos[servo].returnAtMs) >= 0) {
    servos[servo].strikeActive = false;
    setServoTarget(servo, servos[servo].returnAngle);
  }

  if (servos[servo].currentAngle == servos[servo].targetAngle || servos[servo].stepDelayMs == 0) {
    return;
  }

  if (now - servos[servo].lastStepAtMs < (unsigned long)servos[servo].stepDelayMs) {
    return;
  }

  int direction = servos[servo].targetAngle > servos[servo].currentAngle ? 1 : -1;
  writeServoAngle(servo, servos[servo].currentAngle + direction);
  servos[servo].lastStepAtMs = now;
}

void hitServo(int servo) {
  if (servo < 0 || servo >= SERVO_COUNT) {
    Serial.println("ERR invalid servo");
    return;
  }

  servos[servo].strikeActive = true;
  servos[servo].returnAtMs = millis() + max(0, servos[servo].dwellMs);
  setServoTarget(servo, servos[servo].strikeAngle);

  Serial.print("OK HIT ");
  Serial.println(servo);
}

void hitMultipleServos(String line) {
  bool hitAny = false;

  while (line.length() > 0) {
    String servoToken = nextToken(line);
    if (servoToken.length() == 0) {
      break;
    }

    int servo = servoToken.toInt();
    if (servo < 0 || servo >= SERVO_COUNT) {
      Serial.println("ERR invalid servo");
      return;
    }

    servos[servo].strikeActive = true;
    servos[servo].returnAtMs = millis() + max(0, servos[servo].dwellMs);
    setServoTarget(servo, servos[servo].strikeAngle);
    hitAny = true;
  }

  if (!hitAny) {
    Serial.println("ERR missing servo");
    return;
  }

  Serial.println("OK HITM");
}

void restServo(int servo, bool printAck = true) {
  if (servo < 0 || servo >= SERVO_COUNT) {
    Serial.println("ERR invalid servo");
    return;
  }

  servos[servo].strikeActive = false;
  setServoTarget(servo, servos[servo].returnAngle);

  if (printAck) {
    Serial.print("OK REST ");
    Serial.println(servo);
  }
}

String nextToken(String &line) {
  line.trim();
  int spaceIndex = line.indexOf(' ');
  if (spaceIndex < 0) {
    String token = line;
    line = "";
    return token;
  }

  String token = line.substring(0, spaceIndex);
  line = line.substring(spaceIndex + 1);
  return token;
}

void printServoStatus(int servo) {
  if (servo < 0 || servo >= SERVO_COUNT) {
    Serial.println("ERR invalid servo");
    return;
  }

  Serial.print("SERVO ");
  Serial.print(servo);
  Serial.print(" return=");
  Serial.print(servos[servo].returnAngle);
  Serial.print(" strike=");
  Serial.print(servos[servo].strikeAngle);
  Serial.print(" dwell=");
  Serial.print(servos[servo].dwellMs);
  Serial.print(" step_delay=");
  Serial.print(servos[servo].stepDelayMs);
  Serial.print(" current=");
  Serial.println(servos[servo].currentAngle);
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) {
    return;
  }

  String command = nextToken(line);
  command.toUpperCase();

  if (command == "PING") {
    Serial.println("OK PONG");
    return;
  }

  if (command == "HIT") {
    int servo = nextToken(line).toInt();
    hitServo(servo);
    return;
  }

  if (command == "HITM") {
    hitMultipleServos(line);
    return;
  }

  if (command == "REST") {
    int servo = nextToken(line).toInt();
    restServo(servo);
    return;
  }

  if (command == "ALLREST") {
    for (int servo = 0; servo < SERVO_COUNT; servo++) {
      restServo(servo, false);
    }
    Serial.println("OK ALLREST");
    return;
  }

  if (command == "SET") {
    int servo = nextToken(line).toInt();
    int returnAngle = nextToken(line).toInt();
    int strikeAngle = nextToken(line).toInt();
    int dwellMs = nextToken(line).toInt();
    int stepDelayMs = nextToken(line).toInt();

    if (servo < 0 || servo >= SERVO_COUNT) {
      Serial.println("ERR invalid servo");
      return;
    }

    servos[servo].returnAngle = constrain(returnAngle, 0, 180);
    servos[servo].strikeAngle = constrain(strikeAngle, 0, 180);
    servos[servo].dwellMs = max(0, dwellMs);
    servos[servo].stepDelayMs = max(0, stepDelayMs);
    servos[servo].strikeActive = false;
    writeServoAngle(servo, servos[servo].returnAngle);
    servos[servo].targetAngle = servos[servo].returnAngle;

    Serial.print("OK SET ");
    Serial.println(servo);
    return;
  }

  if (command == "STATUS") {
    String servoToken = nextToken(line);
    if (servoToken.length() == 0) {
      for (int servo = 0; servo < ACTIVE_SERVO_COUNT; servo++) {
        printServoStatus(servo);
      }
    } else {
      printServoStatus(servoToken.toInt());
    }
    return;
  }

  Serial.println("ERR unknown command");
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }

  Wire.begin();
  pwm.begin();
  pwm.setPWMFreq(SERVO_FREQ);
  delay(10);

  for (int servo = 0; servo < SERVO_COUNT; servo++) {
    servos[servo].returnAngle = DEFAULT_RETURN_ANGLE;
    servos[servo].strikeAngle = DEFAULT_STRIKE_ANGLE;
    servos[servo].dwellMs = DEFAULT_DWELL_MS;
    servos[servo].stepDelayMs = DEFAULT_STEP_DELAY_MS;
    servos[servo].currentAngle = DEFAULT_RETURN_ANGLE;
    servos[servo].targetAngle = DEFAULT_RETURN_ANGLE;
    servos[servo].lastStepAtMs = 0;
    servos[servo].returnAtMs = 0;
    servos[servo].strikeActive = false;
    writeServoAngle(servo, DEFAULT_RETURN_ANGLE);
  }

  Serial.println("READY robot_drummer_firmware");
}

void loop() {
  unsigned long now = millis();
  for (int servo = 0; servo < SERVO_COUNT; servo++) {
    updateServo(servo, now);
  }

  while (Serial.available() > 0) {
    char incoming = Serial.read();
    if (incoming == '\n' || incoming == '\r') {
      handleCommand(inputLine);
      inputLine = "";
    } else {
      inputLine += incoming;
    }
  }
}
