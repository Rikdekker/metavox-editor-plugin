# Plan: Metadata synchronisatie met document properties

## Hoe SharePoint en Microsoft Office het doen

Microsoft gebruikt drie mechanismen om metadata in Office documenten op te slaan:

### 1. Core Properties (`docProps/core.xml`)
Standaard Dublin Core velden: title, subject, creator, description, keywords, dates. Zit in elk OOXML bestand. Beperkt tot vaste velden.

### 2. Custom Properties (`docProps/custom.xml`)
Key-value pairs voor willekeurige metadata:
```xml
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties">
  <property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Department">
    <vt:lpwstr>R&amp;D</vt:lpwstr>
  </property>
</Properties>
```
Types: `vt:lpwstr` (tekst), `vt:filetime` (datum), `vt:i4` (integer), `vt:bool`, `vt:r8` (float).

### 3. Custom XML Parts (`customXml/`)
SharePoint gebruikt dit voor complexe metadata (managed metadata, multi-value). Eigen XML schema.

### SharePoint synchronisatie
- **Bi-directioneel**: Kolom wijzigen in SharePoint → document updatet. Property wijzigen in Word → SharePoint updatet bij save.
- **Quick Parts**: Insert → Quick Parts → Document Property → Content Control in document die live gekoppeld is aan de property.
- Werkt alleen in desktop Word, niet in browser.

### ODF
Metadata in `meta.xml`: `<meta:user-defined meta:name="Department" meta:value-type="string">R&D</meta:user-defined>`

---

## Voorstel voor MetaVox

### Aanpak: Custom Properties syncen bij opslaan

Server-side: wanneer een document wordt opgeslagen, schrijft MetaVox de metadata als custom properties in het bestand. Metadata wordt leesbaar buiten Nextcloud (Windows Verkenner, macOS Finder, export).

### Implementatie: Server-side bij save callback

De ONLYOFFICE connector stuurt een callback naar Nextcloud bij save. MetaVox listener:
1. Opent het bestand als ZIP
2. Leest/schrijft `docProps/custom.xml` (OOXML) of `meta.xml` (ODF)
3. Synchroniseert MetaVox velden

### Veldtype mapping

| MetaVox type | OOXML type | ODF type |
|-------------|-----------|---------|
| text, textarea | `vt:lpwstr` | `string` |
| number | `vt:r8` | `float` |
| date | `vt:filetime` | `date` |
| checkbox | `vt:bool` | `boolean` |
| select | `vt:lpwstr` | `string` |
| multiselect | `vt:lpwstr` (`;#` joined) | `string` |
| url | `vt:lpwstr` | `string` |
| user | `vt:lpwstr` | `string` |

### Bestandsformaten: wat wordt ondersteund?

| Formaat | Extensies | Open standaard? | Properties locatie | Support |
|---------|-----------|----------------|-------------------|---------|
| **OOXML** | .docx, .xlsx, .pptx | Ja (ISO/IEC 29500) | `docProps/custom.xml` | Fase 1 |
| **ODF** | .odt, .ods, .odp | Ja (ISO/IEC 26300) | `meta.xml` | Fase 2 |
| **PDF** | .pdf | Ja (ISO 32000) | XMP metadata | Later |
| Legacy Office | .doc, .xls, .ppt | Nee (proprietary) | OLE structured storage | Niet ondersteund |
| Afbeeldingen | .jpg, .png, .tiff | Deels | EXIF/XMP | Niet ondersteund |
| Plaintext | .txt, .csv, .md | N/A | Geen metadata container | Niet ondersteund |

### Advies: focus op open standaarden

**Aanbeveling: alleen OOXML en ODF ondersteunen.**

Beide zijn open ISO-standaarden, beide gebruiken ZIP+XML, en beide worden ondersteund door Euro-Office, LibreOffice, en Microsoft Office. Dit dekt ~95% van de documenten in een typische organisatie.

**Waarom niet legacy formaten (.doc, .xls)?**
- Proprietary binary formaat — complexe parsing libraries nodig
- Euro-Office/ONLYOFFICE converteert ze sowieso naar OOXML bij bewerken
- Nextcloud toont een waarschuwing om te converteren
- Afnemend gebruik in organisaties

**Waarom niet PDF (nu)?**
- PDF metadata (XMP) is een ander mechanisme — geen ZIP+XML maar embedded XML stream
- Vereist een PDF library (bijv. TCPDF, FPDI)
- PDF's worden in Nextcloud zelden bewerkt — meestal read-only
- Kan later als Fase 3 toegevoegd worden

**Waarom niet afbeeldingen?**
- Metadata in EXIF/XMP — ander mechanisme
- MetaVox is gericht op documenten, niet op mediabestanden
- Nextcloud heeft eigen metadata voor foto's

**Conclusie**: OOXML + ODF is de sweet spot. Beide zijn open, beide werken met dezelfde ZIP+XML aanpak, en dekken alle documenten die in Euro-Office bewerkt worden.

### Wijzigingen in MetaVox

| Component | Wijziging |
|-----------|-----------|
| `lib/Listener/` | Listener voor NodeWrittenEvent |
| `lib/Service/DocumentPropertiesService.php` | Nieuw — leest/schrijft custom properties |
| `appinfo/info.xml` | Event listener registratie |
| Admin settings | Toggle: "Sync metadata to document properties" |

---

## Schaalbaarheid

Bij elke document-save wordt het bestand als ZIP geopend, XML geparst, properties bijgewerkt, en het ZIP teruggeschreven. De impact:

| Scenario | Impact |
|----------|--------|
| 1 gebruiker, 1 document | ~50ms extra per save — verwaarloosbaar |
| 50 gebruikers tegelijk | 50 parallelle ZIP operaties — merkbare I/O belasting |
| Bulk import 10.000 bestanden | Duizenden ZIP operaties — kan minuten duren |
| Grote bestanden (100MB+ .pptx) | Meer geheugen en I/O per operatie |

### Mitigatie

- **Alleen bij metadata-wijziging**: skip sync als metadata niet gewijzigd is sinds laatste sync
- **Queue-based verwerking**: gebruik Nextcloud background jobs i.p.v. synchrone verwerking bij save
- **Admin toggle**: feature uitschakelbaar per installatie
- **Format check**: alleen voor OOXML/ODF — skip niet-ondersteunde formaten direct

**Conclusie**: synchrone ZIP manipulatie bij elke save werkt voor kleine installaties. Op schaal is queue-based verwerking noodzakelijk.

---

## Zonder MetaVox: wat gebeurt er?

De custom properties zitten IN het bestand als standaard OOXML/ODF metadata. Ze zijn volledig onafhankelijk van MetaVox.

| Scenario | Gedrag |
|----------|--------|
| Document geopend in Microsoft Word | Properties zichtbaar via File → Properties → Custom |
| Document geopend in LibreOffice | Properties zichtbaar via File → Properties → Custom Properties |
| Document geopend in ONLYOFFICE Desktop | Properties zichtbaar via File → Document Info |
| Document geopend zonder office app | Properties leesbaar via file explorers (beperkt) |
| MetaVox niet geïnstalleerd | Properties blijven in het bestand, geen errors, geen sync |
| MetaVox plugin niet in Euro-Office | Properties niet zichtbaar in editor panel, maar wel in bestand |
| Document geëxporteerd uit Nextcloud | Metadata reist mee in het bestand |

**Geen vendor lock-in**: de metadata is opgeslagen in open standaard formaten en leesbaar door elke office applicatie.

---

## Zichtbaarheid in het document (Content Controls)

Metadata kan niet alleen als bestandseigenschap opgeslagen worden, maar ook **zichtbaar in de tekst** via Content Controls.

### Hoe het eruitziet

```
┌─────────────────────────────────────────────────┐
│                                                   │
│  Report Title                                     │
│                                                   │
│  Department: [ R&D          ]  ← Content Control  │
│  Status:     [ Draft        ]  ← Content Control  │
│  Author:     [ Erik Smit    ]  ← Content Control  │
│                                                   │
│  Lorem ipsum dolor sit amet...                    │
│                                                   │
└─────────────────────────────────────────────────┘
```

Content Controls zijn live velden die automatisch updaten wanneer de property wijzigt. In de browser-editor zijn ze zichtbaar maar beperkt bewerkbaar (zelfde beperking als SharePoint + Word Online).

### Invoegen via de plugin

Twee opties voor het invoegen van metadata als Content Controls:

**Optie A: Insert-knoppen in het MetaVox plugin panel** (simpel)
- Per veld een "insert" icoon
- Klik → plugin voegt Content Control in op cursorpositie via `InsertAndReplaceContentControls` API

**Optie B: Toolbar dropdown in de ribbon** (mooier, later)
- Knop in de Plugins tab met dropdown van alle MetaVox velden
- Vergelijkbaar met SharePoint Quick Parts ervaring
- Vereist `ButtonToolbar` API integratie

---

## Impact overzicht

| Component | Wat moet er gebeuren | Complexiteit |
|-----------|---------------------|-------------|
| **MetaVox (server)** | DocumentPropertiesService + event listener + admin toggle | Medium-hoog |
| **Editor plugin** | Optioneel: insert-knoppen voor Content Controls | Laag |
| **Bestaande documenten** | Geen impact — sync start pas bij volgende save | Geen |
| **Performance** | Queue-based verwerking nodig op schaal | Medium |
| **Zonder MetaVox** | Properties leesbaar in elke Office app — geen lock-in | Geen impact |

---

## Fasering

1. **Fase 1**: Write — MetaVox → document custom properties bij save (OOXML)
2. **Fase 2**: ODF support
3. **Fase 3**: Read — Document properties → MetaVox bij upload
4. **Fase 4**: Bi-directioneel — conflictresolutie bij wijzigingen in beide richtingen
5. **Fase 5**: Content Controls — metadata invoegbaar als velden in het document
6. **Fase 6**: Toolbar — Quick Parts equivalent in Euro-Office ribbon
