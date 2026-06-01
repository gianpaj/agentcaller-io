# TODO

## Providers


### Twilio

Industry-leading cloud communications platform with global reach

### Vonage

High-quality voice with 16kHz audio and excellent international coverage

### Plivo

Cloud communications platform with programmable voice and global PSTN reach

### Telnyx


### Cloudonix

SIP-based telephony with flexible trunk configuration

### Vobiz

<https://www.vobiz.ai>

Cloud-based telephony with global reach and competitive pricing

### Asterisk ARI

Connect to your own Asterisk PBX via the Asterisk REST Interface

https://docs.dograh.com/integrations/telephony/overview


## see

<https://docs.dograh.com/sdks/outbound-calls>

---

<https://grok.com/share/bGVnYWN5LWNvcHk_7973c435-695c-4098-b388-54c73eb5739f>

**Yes — here’s a clear comparison of Twilio vs. the best alternatives for outbound voice calls to Spain (+34 numbers), focused on your agentic voice setup (restaurant bookings, etc.).** All of these work well with the open-source projects we discussed (Vocode, LiveKit Agents, Pipecat, Dograh, Intervo) via native API support or SIP trunks.

Pricing is **outbound termination rates only** (what you pay per minute of call duration to a Spanish number). Since you’re in Italy (EEA/EU), **origin-based pricing** applies — this is the key factor that makes calls from an EEA-hosted number or trunk much cheaper.

### Pricing comparison (as of May 2026, USD per minute)

| Provider       | To Spain Landline/Fixed (from EEA) | To Spain Mobile (from EEA) | Billing Increment | Notes / Volume Discounts | Phone Number Cost (example) | Best For Open-Source Integration |
|----------------|------------------------------------|----------------------------|-------------------|---------------------------|-----------------------------|----------------------------------|
| **Twilio**    | **$0.0178**                       | **$0.0486**               | Per second (most routes) | Automatic volume discounts at high usage | ~$1.15/mo per local/international number | Native support in almost every framework (easiest) |
| **Plivo**     | **$0.0071**                       | **$0.0314**               | Per second       | Volume discounts available | ~$1–2/mo (Spain or EU numbers) | Excellent — full Voice API + SIP trunking |
| **Telnyx**    | Starting ~$0.005–$0.007 (international) | Same range               | Per second       | Strong automatic volume discounts; global price sheet | Spain local from $1/mo     | Great (SIP + Voice API) — very popular with LiveKit/Pipecat |
| **Vonage**    | ~$0.008–$0.015 (international PSTN) | Similar                   | Per second       | Custom/volume deals common | Competitive EU numbers     | Good native support in most frameworks |
| **Infobip**   | Custom (portal calculator)        | Custom                    | Per second       | Enterprise volume pricing | Custom                     | Solid for Europe, SIP-friendly   |
