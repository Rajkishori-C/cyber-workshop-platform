# CTF Challenge Configuration Schema Documentation

The `challenges.json` file controls all challenges available on the platform. You can add, edit, or remove challenges at any time by editing `challenges.json` directly. The changes take effect immediately on next page load or server start without modifying any Python, HTML, or JavaScript code.

---

## JSON Schema Specification

Each entry in the array `challenges.json` is a JSON object with the following fields:

| Field | Type | Required? | Allowed Values / Example | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | String | **Required** | `"web-01"`, `"stego-02"`, `"crypto-03"` | Unique identifier. Use lowercase alphanumeric with dashes. |
| `title` | String | **Required** | `"Inspect the Unseen"` | Display title shown on the challenge card. |
| `category` | String | **Required** | `"Web Security"`, `"OSINT"`, `"Steganography"`, `"Linux/Command Line"`, `"Forensics"`, `"Encoding"`, `"Basic Programming"`, or any custom category | Category name used for tab filtering. |
| `difficulty` | String | **Required** | `"easy"`, `"medium"`, `"hard"` | Difficulty level (color-coded green, amber, red). |
| `points` | Integer | **Required** | `100`, `150`, `200`, `300` | Points awarded to the team upon successful submission. |
| `description` | String | **Required** | HTML or Plaintext (e.g. `"Analyze the log..."`) | Challenge description and scenario. Supports basic HTML tags (`<code>`, `<pre>`, `<br>`, `<b>`). |
| `hint` | String | Optional | `"Check line 380 for base64 strings."` | Hint revealed when participant clicks 'Unlock Hint'. |
| `hint_cost` | Integer | Optional | `15`, `25`, `0` | Points deducted from team score when hint is unlocked. Defaults to `0` if omitted. |
| `flag` | String | **Required** | `"CTF{example_flag_value}"` | **Server-side only secret flag.** The server strictly strips this field before sending data to clients. |
| `files` | Array | Optional | `[{"name": "dump.pcap", "url": "/challenge_files/dump.pcap"}]` | List of downloadable companion files placed in `challenge_files/`. Empty array `[]` if none. |

---

## Copy-Paste Template for New Challenges

### Standard Challenge (No Downloadable Files)
```json
{
  "id": "osint-03",
  "title": "Satellite Intercept",
  "category": "OSINT",
  "difficulty": "easy",
  "points": 100,
  "description": "Describe the puzzle scenario and objective clearly here. You can use <code>code tags</code> for emphasis.",
  "hint": "Provide a helpful nudge here that guides them without spoiling the entire answer.",
  "hint_cost": 15,
  "flag": "CTF{your_secret_flag_here}",
  "files": []
}
```

### Challenge with Supporting Downloadable File
To attach a file:
1. Copy your file (e.g. `secret.pcap` or `clue.png`) into the folder: `challenge_files/`
2. Add the challenge object to `challenges.json` with the file URL `/challenge_files/<filename>`:

```json
{
  "id": "forensics-03",
  "title": "Network Packet Capture",
  "category": "Forensics",
  "difficulty": "medium",
  "points": 150,
  "description": "Download the captured network dump and extract the HTTP password sent in plaintext.",
  "hint": "Filter by 'http.request.method == POST' in Wireshark.",
  "hint_cost": 25,
  "flag": "CTF{pl41nt3xt_cr3ds_3xp0s3d}",
  "files": [
    {
      "name": "traffic.pcap",
      "url": "/challenge_files/traffic.pcap"
    }
  ]
}
```

---

## Critical Rules to Remember
1. **Unique IDs**: Every challenge MUST have a unique `id`.
2. **Server-Side Security**: The `flag` attribute is evaluated **strictly on the server**. The server code strips this property before serializing challenges to the browser.
3. **Case Sensitivity**: Flags are checked with whitespace trimmed (`.strip()`). It is recommended to use standard `CTF{...}` casing.
4. **Valid JSON**: Always ensure commas are placed correctly between objects in `challenges.json`, and do not leave a trailing comma after the last item.
