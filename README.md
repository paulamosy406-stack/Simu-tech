# SIMUTECH MOD – Technology Tools and Programs

Website kamili: Frontend + Backend + Database (SQLite) + Admin Panel + Malipo + Access Codes + WhatsApp + AI Assistant (hiari).
Haina dependencies za npm; inahitaji **Node.js 22.5 au zaidi** tu.

```
server/server.js   Backend (API, database, sessions, rate limiting, uploads)
public/            Frontend (HTML/CSS/JS), logo, favicon, og.png
test/e2e.js        Majaribio ya API (npm test)  – 89 checks
test/ui.js         Majaribio ya browser (hiari; yanahitaji Playwright + Chrome)
data/              Database na picha (inatengenezwa yenyewe; usiiweke kwenye git)
```

## 1. Kuendesha kwenye kompyuta yako

```bash
cd simutech-mod
cp .env.example .env      # hiari; weka ADMIN_PASSWORD kama unataka
npm start                 # kisha fungua http://localhost:3000
```

**Password ya kwanza ya Admin**: ukiweka `ADMIN_PASSWORD` (angalau herufi 10) ndiyo itatumika. Ukiacha tupu, password ya nasibu
itachapishwa kwenye server log mara ya kwanza (na kuhifadhiwa kwenye `data/INITIAL_ADMIN_PASSWORD.txt`).
Ingia kwa kubonyeza **alama ndogo ya kufuli chini kabisa ya ukurasa**, kisha badilisha password kwenye *Usalama*, na ufute faili hilo.

> Kumbuka: `npm start` haihitaji "build". Frontend ni faili za kawaida; production build = kuendesha `npm start`.

## 2. Hatua za kwanza kwenye Admin Panel

Website inaanza **bila programs, bila namba za malipo na bila Access Codes** (hakuna data ya kubuni). Weka mwenyewe:

1. **Njia za Malipo** → ongeza jina la huduma, namba, jina la mpokeaji → washa *ACTIVE* na *APPROVED*. Wateja wanaona tu zilizo na zote mbili.
2. **Tools** → *Ongeza program* (picha, category, bei, FREE/PREMIUM, maelekezo). Categories 10 za mfano zimeundwa; unaweza kuzihariri/kufuta.
3. **WhatsApp** → namba ya Admin imewekwa `0632414199` (kutoka kwenye maelekezo yako); inabadilika hapo. Inatumika ndani ya kitufe tu; haionyeshwi kama maandishi.
4. **Channel** → weka link ya WhatsApp Channel (`https://…`) na uwashe kitufe. Bila link, kitufe hakionekani.
5. **AI Assistant** (hiari) → washa, weka maelekezo na Maswali/Majibu. Inahitaji `ANTHROPIC_API_KEY` kwenye server.

### Mtiririko wa malipo
Mteja: **FUNGUA PROGRAM** → soma maelekezo → **ENDELEA KWENYE MALIPO** → (ingia/jisajili) → lipa → **SUBMIT PAYMENT PROOF** → **WHATSAPP – PATA ACCESS CODE**.
Admin: *Uthibitisho wa Malipo* → kagua screenshot na kiasi → **THIBITISHA** → **TOA ACCESS CODE** → mtumie mteja (WhatsApp) →
mteja anaiweka kwenye **VERIFY ACCESS CODE**. Screenshot peke yake **haitoi** access; code haiwezi kutolewa kabla malipo hayajathibitishwa.

## 3. Environment variables

| Jina | Maana |
|---|---|
| `PORT` | Port ya server (default 3000; hosting nyingi huiweka yenyewe) |
| `ADMIN_PASSWORD` | Password ya kwanza ya Admin (inatumika mara ya kwanza tu) |
| `DATA_DIR` | Mahali pa database na picha – **lazima iwe diski ya kudumu** |
| `TRUST_PROXY` | `1` ukiwa nyuma ya proxy ya hosting (ili IP/HTTPS zitambulike) |
| `ANTHROPIC_API_KEY` | Hiari – AI Assistant. Inabaki server-side tu |
| `AI_MODEL` | Hiari – model ya AI (default `claude-sonnet-5-5`; inabadilika pia kwenye Admin) |
| `WHATSAPP_ADMIN_NUMBER` | Namba ya kuanzia ya WhatsApp (baadaye ibadilishe kwenye Admin Panel) |

## 4. Deployment – ukweli kuhusu "free hosting"

**Netlify na Firebase Hosting peke yake hazitoshi.** Zinatoa static files tu; website hii ina backend ya Node na database,
kwa hiyo backend lazima iendeshwe mahali ambapo Node server inaweza kukaa na **diski ya kudumu** (kwa sababu database na screenshots za malipo
zinahifadhiwa kwenye `DATA_DIR`). Kwenye hosting nyingi za bure diski ni ya muda na data hufutika kila redeploy/restart – **usitumie hiyo kwa malipo halisi**.

Njia zinazofanya kazi:

- **Njia rahisi (inapendekezwa): Node host moja inayotoa kila kitu** (Render, Railway, Fly.io, VPS n.k.) na **persistent disk/volume**
  (kwenye majukwaa mengi hii ni huduma ya kulipia kidogo; angalia bei zao za sasa).
  1. Pakia folda hii kwenye GitHub (au tumia `Dockerfile` iliyopo).
  2. Tengeneza *Web Service* (Node) – Build: *(hakuna)*, Start: `npm start`.
  3. Weka env vars: `ADMIN_PASSWORD`, `TRUST_PROXY=1`, `DATA_DIR=/data` (au njia ya diski ya kudumu), hiari `ANTHROPIC_API_KEY`.
  4. Unganisha persistent disk/volume kwenye `DATA_DIR`.
  5. Fungua link ya hosting → unaingia moja kwa moja kwenye Home Page ya SIMUTECH MOD (si AI Studio wala developer preview). Links za ndani kama `/#/tool/3` zinafanya kazi zikifunguliwa moja kwa moja.
- **Netlify kwa frontend + Node host kwa backend**: weka `netlify.toml` (publish = `public`) yenye rewrites zinazopeleka `/api/*` na `/uploads/*`
  kwenye URL ya backend yako (`status = 200`), ili cookies na API ziendelee kuwa *same-origin*:
  ```toml
  [build]
    publish = "public"
  [[redirects]]
    from = "/api/*"
    to = "https://BACKEND-YAKO/api/:splat"
    status = 200
  [[redirects]]
    from = "/uploads/*"
    to = "https://BACKEND-YAKO/uploads/:splat"
    status = 200
  ```
- **Firebase**: Hosting inaweza kutuma `/api/**` kwenda backend iliyowekwa kwenye Cloud Run (kwa kawaida inahitaji akaunti ya billing) – bado inahitaji volume/diski ya kudumu kwa SQLite.

Domain: usajili wa domain ni hatua yako; mpaka ufanye hivyo, tumia link ya hosting.

**Backup**: nakili folda ya `DATA_DIR` mara kwa mara (ina `simutech.db` na `uploads/`).

## 5. Usalama uliojengwa

- Password ya Admin: scrypt hash, inahakikiwa na server; haipo kwenye frontend.
- Rate limiting: majaribio 5 ya password ya Admin / dakika 15 / IP (pia kikomo cha jumla); login ya watumiaji, access code verify, malipo na AI pia zina vikomo.
- Sessions: tokens za nasibu (zinahifadhiwa kama hash), cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` kwenye HTTPS); Admin anatolewa baada ya dakika 30 za kutotumia (inabadilika) au saa 12 kwa jumla; Logout inafunga session.
- Kila ombi linalobadilisha data linahitaji header ya `X-Requested-With` (kinga ya CSRF pamoja na SameSite).
- Access Codes zinahakikiwa kwenye server tu; code ya mtumiaji maalumu haiwezi kutumika na mwingine; code moja haitumiki na watu wawili; code iliyofutwa/iliyoisha inakataliwa.
- Namba za malipo zisizo-APPROVED/ACTIVE hazitumwi kamwe kwa wateja. Screenshots za malipo ni za Admin tu.
- Picha zinakaguliwa (magic bytes), SVG hairuhusiwi; CSP, `X-Frame-Options`, `nosniff` zimewekwa.
- Transaction ID haiwezi kutumika mara mbili.

## 6. Mipaka ya sasa (usidhani kuwa imefanyika)

- **Uthibitisho wa malipo ni wa mikono (Admin)**. Uthibitishaji wa moja kwa moja kupitia API ya mtoa huduma wa malipo haujajengwa; unahitaji akaunti/API ya mtoa huduma husika.
- Rate limiting iko kwenye kumbukumbu ya server (inaanza upya server ikizimwa; haishirikiwi kati ya server nyingi).
- Access Codes zinahifadhiwa wazi kwenye database (server-side) ili Admin azione tena; linda faili ya database.
- Hakuna barua pepe/SMS; mawasiliano ya Access Code ni kupitia WhatsApp kama ulivyoelekeza.
- AI Assistant haijajaribiwa na Claude API halisi hapa (ilijaribiwa kwa seva bandia ya upstream); ukiiwasha, jaribu mwenyewe kwa swali la kweli.
- `Dockerfile` haijajaribiwa hapa (hakukuwa na Docker).
- Imejaribiwa kwa Chrome (mobile emulation 390px, tablet 820px, desktop 1366px). Haijajaribiwa kwenye iPhone/Safari na simu halisi za Android – tafadhali jaribu kabla ya kutangaza.

## 7. Majaribio

```bash
npm test                      # API: 89 checks (inatumia database ya muda)
node test/ui.js ./shots       # Browser (inahitaji Playwright + Chrome): 56 checks + screenshots
```
