# Outreach Automation MVP Plan — Chair Liquidation Pipelines

**Owner:** Abdel | **Created:** April 4, 2026 | **Goal:** Get MVPs running this weekend

---

## What You Already Have

- **89 venue leads** across 9 metros (Atlanta, DC, Baltimore, NoVA, San Diego, LA, Lawrence/KC, etc.)
- **55 named contacts** with roles (VP Operations, Facilities Directors, Church Admins, etc.)
- **Research report** with email templates, compliance rules, and full strategy
- **requirements.txt** with Python dependencies defined
- **Gmail** as your sending tool

---

## The 5 MVPs — Each Is Independent and Testable

Think of these as 5 separate experiments you can launch, test, and iterate on independently. Start with MVP 1 today, layer the others as each one proves out.

---

### MVP 1: Gmail Cold Email Pipeline (START TODAY)
**What it does:** Takes your enriched leads, personalizes emails using Claude, and sends via Gmail.

**Why first:** You have the leads and templates. This is the fastest path to real replies in your inbox.

**Components to build:**
1. **Lead loader** — Python script that reads `Venue_Leads_Enriched.xlsx` (the "Leads Apr 2026" sheet) and outputs a clean list: venue name, contact name, role, email/phone, capacity, hot-lead signals
2. **Email personalizer (Claude agent)** — Takes each lead + your base template and generates a personalized email. Uses the hot-lead signals and venue details to make each email feel researched (e.g., "I saw GWCCA recently appointed a new VP of Campus Operations — are there any furniture refresh plans?")
3. **Gmail sender** — Python script using Gmail API to send personalized emails with proper throttling (max 20-30/day to start, spread across the day)
4. **Tracking sheet** — Auto-logs every send: date, venue, contact, email used, subject line, status

**Test strategy:**
- Start with **Lawrence/KC leads only** (14 leads, closest to home, easiest to follow up)
- Send 5 emails manually first, review the personalization quality
- Then automate the remaining 9
- Track: open signals (if using a tracker), reply rate, bounce rate

**Success metric:** ≥2 replies from the first 14 sends within 7 days

**Key files to create:**
```
outreach/
├── lead_loader.py          # Reads XLSX, outputs clean lead records
├── email_personalizer.py   # Claude API call to personalize each email
├── gmail_sender.py         # Gmail API sending with throttling
├── tracker.py              # Logs sends to a tracking spreadsheet
├── templates/
│   ├── initial_outreach.txt
│   ├── followup_bump.txt
│   └── followup_timing.txt
└── config.env              # API keys, sending limits, etc.
```

---

### MVP 2: Reply Classification Agent (BUILD AFTER FIRST REPLIES COME IN)
**What it does:** Monitors your Gmail for replies to outreach emails, classifies them using Claude, and routes them.

**Why second:** Once emails are flowing, you need to handle replies fast. Manual triage won't scale.

**Components to build:**
1. **Gmail monitor** — Scheduled task (or Cowork scheduled task) that checks for new replies every 30 min
2. **Reply classifier (Claude agent)** — Reads each reply and classifies it:
   - **🟢 Interested** — Has chairs or is open to discussing → Flag for immediate follow-up
   - **🟡 Not now / Check back later** — Set a reminder for the date they mention
   - **🔵 Wrong person** — Extract the referral name/role → Add to leads
   - **🔴 Not interested / Unsubscribe** — Mark suppressed, never contact again
3. **Action router** — Based on classification, either drafts a response, creates a follow-up task, or updates the tracking sheet

**Test strategy:**
- Run on your first 10-20 replies manually to validate classification accuracy
- Compare Claude's classification vs your own judgment
- Tune the prompt until accuracy is ≥90%

**Success metric:** Correctly classifies 9/10 replies, saves you 5+ min per reply

---

### MVP 3: Lead Enrichment Agent (RUN IN PARALLEL WITH MVP 1)
**What it does:** For leads that don't have named contacts or email addresses, this agent researches the venue and finds the right person.

**Why parallel:** 34 of your 89 leads don't have named contacts yet. This agent fills those gaps.

**Components to build:**
1. **Gap identifier** — Script that filters leads with missing contact info
2. **Web research agent (Claude + web search)** — For each venue, searches for:
   - Facilities/operations director name
   - Procurement/purchasing contacts
   - Recent renovation or expansion news (hot-lead signals)
   - Email patterns from the domain
3. **Enrichment writer** — Updates the XLSX with new contacts found

**Test strategy:**
- Run on 10 leads with missing contacts
- Manually verify 5 of the contacts found
- Measure: contacts found per lead, accuracy of role identification

**Success metric:** Find valid contacts for ≥6 of 10 leads tested

---

### MVP 4: Phone Outreach Prep Agent (LAYER ONTO HOT LEADS)
**What it does:** For leads that reply positively or show hot signals, generates a call prep sheet so you can make effective follow-up calls.

**Why layer:** Phone converts better than email for negotiation. But you need to know what to say.

**Components to build:**
1. **Call prep generator (Claude agent)** — For each hot lead, produces:
   - 30-second opening script customized to the venue
   - Key questions to ask (chair quantity, condition, brand, timing, price expectations)
   - Objection responses (common pushbacks and how to handle them)
   - Logistics checklist (pickup access, loading dock, elevator, timing constraints)
2. **Call log** — Simple form/sheet to log call outcomes

**Test strategy:**
- Generate call preps for your top 5 Lawrence/KC leads
- Make the calls, note which prep elements were useful
- Refine the prompt based on real call experience

**Success metric:** Call prep saves you ≥10 min of research per call, you feel prepared

---

### MVP 5: LinkedIn Research Agent (MANUAL + CLAUDE-ASSISTED)
**What it does:** Claude generates personalized LinkedIn connection request messages and follow-up messages. You send them manually (LinkedIn prohibits automation).

**Why manual:** LinkedIn's TOS prohibits automated messaging. But a well-crafted connection request from a real person converts well for B2B.

**Components to build:**
1. **LinkedIn message generator (Claude agent)** — Takes lead info and generates:
   - Connection request note (under 300 chars)
   - Follow-up message after connection accepted
   - InMail template for premium users
2. **LinkedIn research brief** — For each lead, finds their LinkedIn profile URL and recent activity to reference

**Test strategy:**
- Generate messages for 10 leads, send 5 connection requests
- Track accept rate and reply rate
- A/B test: generic vs. highly personalized connection notes

**Success metric:** ≥30% connection accept rate, ≥1 conversation started from 10 attempts

---

## How Claude Agents Fit Into Each MVP

| MVP | Claude's Role | How to Run It |
|-----|---------------|---------------|
| 1. Email Pipeline | Personalizes each email using lead data + templates | Python script calling Claude API, or Cowork session |
| 2. Reply Classifier | Reads replies, classifies intent, suggests next action | Scheduled Cowork task checking Gmail every 30 min |
| 3. Lead Enrichment | Web research to find missing contacts and signals | Cowork session with web search, or Python + Claude API |
| 4. Phone Prep | Generates call scripts and objection handling | On-demand Cowork session per batch of hot leads |
| 5. LinkedIn Messages | Writes personalized connection requests and follow-ups | On-demand Cowork session per batch |

---

## Weekend Launch Sequence

### Saturday Morning: MVP 1 Setup
1. [ ] Set up Gmail API credentials (Google Cloud Console → enable Gmail API → OAuth)
2. [ ] Install Python dependencies from requirements.txt
3. [ ] Build lead_loader.py to read from your XLSX
4. [ ] Write email_personalizer.py with Claude API integration
5. [ ] Build gmail_sender.py with throttling (max 5/hour to start)
6. [ ] Send 5 test emails to yourself to verify formatting and personalization

### Saturday Afternoon: First Live Sends
7. [ ] Select 14 Lawrence/KC leads as your test cohort
8. [ ] Generate personalized emails, review each one manually
9. [ ] Send first batch (5 emails)
10. [ ] Log sends in tracker

### Sunday: Expand + Start MVP 3
11. [ ] Send remaining 9 Lawrence/KC emails
12. [ ] Start MVP 3: run enrichment agent on 10 leads with missing contacts
13. [ ] Review any early replies manually (MVP 2 comes later)
14. [ ] Plan Monday's batch: pick next metro to target

---

## A/B Testing Strategy

Run these tests across different metros to find what works best:

**Email subject lines to test:**
- A: "Quick question — any surplus banquet chairs available?" (direct)
- B: "We buy surplus furniture from venues like {{VenueName}}" (value-first)
- C: "{{FirstName}} — chairs from {{VenueName}}?" (personal + specific)

**Audience segment tests:**
- Convention centers vs. hotels vs. churches (which segment replies most?)
- Named contacts vs. general inquiries (does having a name matter?)
- Hot-lead signals vs. no signals (do renovation cues predict interest?)

**Follow-up timing tests:**
- 3-day vs. 5-day vs. 7-day gap between emails
- 2-step vs. 3-step sequences

Track everything in your spreadsheet so you can compare across segments.

---

## CRM Recommendation

Since you want Gmail + a CRM, here are two fast options:

**HubSpot Free CRM** (recommended to start)
- Free forever tier with contact management, deal tracking, email logging
- Gmail integration built-in
- Can track when contacts open emails
- Easy to set up today

**Pipedrive** (if you want something more sales-focused)
- $14/mo starter plan
- Built for pipeline management (perfect for tracking: lead → contacted → interested → negotiating → picked up)
- Good Gmail integration

Start with HubSpot Free — you can migrate later if needed.

---

## What to Build in Each Cowork Session

When you come back to Cowork, here's how to phrase what you need:

- **"Build MVP 1: Create the email pipeline scripts"** → I'll write lead_loader.py, email_personalizer.py, gmail_sender.py, and tracker.py
- **"Run enrichment on leads missing contacts"** → I'll research venues and update your spreadsheet
- **"Classify these replies"** → I'll read your Gmail replies and categorize them
- **"Generate call preps for these 5 leads"** → I'll create customized call scripts
- **"Write LinkedIn messages for this batch"** → I'll generate connection requests and follow-ups
- **"Set up a scheduled task to check for replies"** → I'll create an automated Gmail monitor

---

## Metrics Dashboard (Track Weekly)

| Metric | Week 1 Target | How to Measure |
|--------|--------------|----------------|
| Emails sent | 25-30 | Tracker spreadsheet |
| Bounce rate | <5% | Count bounces / total sent |
| Reply rate | 10-15% | Replies / total sent |
| Positive reply rate | 3-5% | Interested replies / total sent |
| Contacts enriched | 10+ | New named contacts found |
| Calls made | 3-5 | Call log |
| Deals opened | 1-2 | CRM or tracker |
