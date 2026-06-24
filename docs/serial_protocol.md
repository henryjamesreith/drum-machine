# Serial Protocol

The Python controller sends newline-terminated text commands over USB serial.

## Active channels

- `0`: cymbal
- `1`: small tom
- `2`: big tom, used as the kick drum
- `3`: small tom, used as the snare drum
- `4`: hi-hat

Channels outside `0` through `4` are invalid.
The Arduino responds with `OK ...`, `ERR ...`, or status lines.

Default baud rate:

```text
115200
```

## Commands

```text
PING
```

Checks communication. Expected response:

```text
OK PONG
```

```text
HIT <servo>
```

Moves the servo to its configured strike angle, waits for the configured dwell
time, then returns it to its rest angle.

```text
SET <servo> <return_angle> <strike_angle> <dwell_ms> <step_delay_ms>
```

Configures one servo channel.

```text
REST <servo>
```

Moves one servo to its configured return angle.

```text
ALLREST
```

Moves all servo channels to their configured return angles.

```text
STATUS
STATUS <servo>
```

Prints the current servo configuration.
