# Services

A web app for the DTU course Architecture Masterclass, autumn 2026, part Services (MEP). It reads the MEP model (IFC) of a building in the browser and gives the same values and images for every project. That makes the building services of different projects comparable.

**Open the app:** https://philippklak.github.io/services-app/

Everything runs on your own computer. No file is uploaded, there is no server and no account. It is made for current versions of Chrome, Safari, Firefox and Edge on any system and is tested in Chrome on macOS.

## What you get

- **Data** as CSV and JSON: twelve required values, three optional values and your own values, each with unit and source.
- **Images** as SVG and PNG: an isometric overview of all services and one image per kind of service, all with the same view and scale.
- **A document** with three pages in 16:9 (Overview, Systems, Performance) as PDF, made in the browser: real text and the images as vectors.

## How to use it

1. **Files.** Drop the files of the project: the MEP model (IFC) and the MEP report (PDF). You can drop the other models and reports too. The app finds the model with the building services by its content, not by its name. It shows what it read and checks if the model has what the values need.
2. **Data.** Grey fields are yours to fill in from the report. Under a field the app shows the values it found in the report, for example `Report 40.9 p. 14`. A click fills the field and shows the place in the report. The x empties the field again. Use **Open the report next to the fields** to read and search the report while you fill in. Values read from the model are plain text. You can correct them with **Edit**, the model value stays visible.
3. **Images.** Choose colour or black, storeys shown or hidden, all elements or main runs only.
4. **Export.** Choose the files and click **Download** for one ZIP. **Download PDF** gives the document alone. The PDF is named after the project, for example `services-26-06.pdf`. It is made in about a second, with real text you can select and search and the images as vectors. The text is set in Helvetica, the font every PDF reader has.

Inputs and corrections are kept in your browser for each project, so you can close the page and go on later.

## The values

**Required**

| Value | Unit | Source |
|---|---|---|
| Primary energy, BR18 limit | kWh/m² a | Calculated from building use and heated floor area |
| Result by regulation, BE18 | kWh/m² a | Report |
| Simulated, IDA ICE | kWh/m² a | Report |
| Daylight sDA300 above 50 % | met or not met | Report |
| Heating load | W/m² | Report |
| Indoor climate, hours above 27 °C, worst room | h | Report |
| Indoor climate, time in comfort category II, worst room | % | Report |
| CO₂ max, worst room | ppm | Report |
| Heated floor area | m² | Report |
| Service systems | kinds | Model |
| Ducts and pipes per m² | m/m² | Model and heated floor area |
| Volume of ducts and pipes per m² | m³/m² | Model and heated floor area |

**Optional:** number of components, volume of ducts and pipes, length of ducts and pipes per system. You can add your own values with label and unit.

An empty value is exported as `n/a`, never estimated. Every exported value has a source: `model`, `calculated` or `manual`. A corrected model value keeps the model value in its own column.

## How the values are made

- **Service systems.** The app reads every system of the model (the groups of IfcRelAssignsToGroup) and sorts it by its name into seven kinds: supply air, extract air, intake and exhaust, heating and cooling, water, drainage, sprinkler. Danish and English names are known, for example `VI` and `Indblæsning` for supply air.
- **Length.** The axis length of every duct segment and pipe segment. Fittings are not counted.
- **Volume.** Axis length times cross section of every duct segment and pipe segment, so the air or water inside the ducts and pipes.
- **Per m².** Length and volume divided by the heated floor area. Without the floor area the app shows the totals.
- **BR18 limit.** BR18 § 260 for other buildings: 41.0 + 1000/A. BR18 § 259 for housing, dormitories and hotels: 30.0 + 1000/A. A is the heated floor area. Additions after § 260 stk. 3 (high lighting, extra ventilation, long use, large room heights) come from the energy calculation of the team and are entered with Edit.
- **Storeys** come from IfcBuildingStorey. Each storey is drawn as a light plate in the images.

## Values from the report

For the report fields the app reads the text of the PDF with fixed rules, without AI and without upload. It looks for a number with the right unit near the right words, reads tables with one column per value (the worst room is the highest value, for comfort category II the lowest) and reads statements on daylight. Targets and limits such as "below 1200 ppm" are left out. If nothing fits, nothing is suggested. Nothing is filled in without your click.

Tested on four reports of the course: 21 values found right, 11 correctly left empty, none wrong.

## What a model needs

- Every element belongs to a system.
- The system names say what they are, for example `Ventilation, Supply`.
- The storeys are defined.
- Air terminals are optional. They are drawn in the images and counted in the components.

## Run it on your own computer

The app is a static web page. Browsers only load its modules from a web server, so open it through a small local server. Go into the folder of the app (`services-app` when you clone this repository, `app` in the hand-in package) and start it:

```bash
python3 -m http.server 8766
```

Then open http://localhost:8766 in your browser.

## Files

- `index.html` the page and its styles. `app.js` the four pages, the report next to the fields and the download.
- `core.js` reads the IFC. `data.js` the values and the CSV and JSON export. `pictos.js` the images as SVG. `doc.js` the three document pages. `suggest.js` the values from the report.
- `vendor/` the libraries, copied in so the app needs no network: web-ifc (MPL 2.0), pdf.js 4.10.38 (Apache 2.0), fflate (MIT), jsPDF 4.2.1 (MIT) and svg2pdf.js 2.9.0 (MIT) for the PDF.

## Who made it

Nik and Philipp Klak, group Services, DTU Architecture Masterclass 2026, course organised by Tim McGinley. The code was written with the help of an AI assistant (Claude by Anthropic). The questions, the choice of values, the design and the checks against the reports are ours.
