/**
 * Seed the territories table with the 15 niches x Western micro-territories.
 * Mirrors the spreadsheet tracker. Run once after creating the schema:
 *   node scripts/seed-territories.js
 */
import { pool } from "../engine/engine.js";

const NICHES = ["Barber shops","Nail salons","Auto repair","Landscaping","House cleaning",
  "HVAC","Tattoo shops","Auto detailing","Tree service","Pool service",
  "Handyman","Dog grooming","Food trucks","Window cleaning","Junk removal"];

const REGIONS = {
  "AZ - Phoenix Metro": ["Mesa","Tempe","Chandler","Gilbert","Scottsdale","Glendale","Peoria",
    "Surprise","Avondale","Goodyear","Queen Creek","Phoenix Downtown","Phoenix Arcadia",
    "Phoenix Ahwatukee","Phoenix Deer Valley"],
  "NV - Las Vegas": ["Las Vegas Downtown","Las Vegas Summerlin","Las Vegas Spring Valley",
    "Henderson","North Las Vegas","Paradise"],
  "CA - LA County": ["Downtown LA","Hollywood","Santa Monica","Pasadena","Long Beach",
    "Glendale CA","Burbank","Torrance","Van Nuys","Pomona"],
  "CA - Orange County": ["Anaheim","Santa Ana","Irvine","Huntington Beach","Costa Mesa","Fullerton"],
  "CA - San Diego": ["San Diego Downtown","Chula Vista","Escondido","El Cajon","Oceanside","La Mesa"],
  "CO - Denver Metro": ["Denver Downtown","Aurora","Lakewood","Arvada","Westminster","Centennial","Boulder"],
  "UT - Salt Lake City": ["SLC Downtown","West Valley City","Sandy","Provo","Ogden","Orem"],
  "WA - Seattle Metro": ["Seattle Downtown","Seattle Ballard","Bellevue","Tacoma","Kent","Everett","Renton"],
  "OR - Portland Metro": ["Portland Downtown","Portland SE","Gresham","Beaverton","Hillsboro","Salem OR"],
};

async function main() {
  const client = await pool.connect();
  let n = 0;
  try {
    await client.query("BEGIN");
    for (const [region, areas] of Object.entries(REGIONS)) {
      for (const area of areas) {
        for (const niche of NICHES) {
          await client.query(
            `INSERT INTO territories (region,area,niche)
             VALUES ($1,$2,$3) ON CONFLICT (area,niche) DO NOTHING`,
            [region, area, niche]
          );
          n++;
        }
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK"); throw e;
  } finally {
    client.release();
  }
  console.log(`[seed] ensured ${n} territory rows (15 niches x ${n/15} areas)`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
