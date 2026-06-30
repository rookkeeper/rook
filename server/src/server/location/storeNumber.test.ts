// @vitest-environment node
import { describe, expect, it } from "vitest";
import { storeNumberFromWebsite } from "./storeNumber.js";

describe("storeNumberFromWebsite", () => {
  it("extracts store numbers from confirmed chain URLs", () => {
    const cases: Array<[string, string, string]> = [
      ["homedepot.com", "https://www.homedepot.com/l/Cleveland/TN/Cleveland/37312/743", "743"],
      ["lowes.com", "https://www.lowes.com/store/TN-Nashville/0629?cm=x", "0629"],
      ["target.com", "https://www.target.com/sl/smyrna/2360", "2360"],
      ["walmart.com", "https://www.walmart.com/store/738/camden-tn/details", "738"],
      ["bestbuy.com", "https://stores.bestbuy.com/tn/clarksville/2801-wilma-rudolph-blvd-2859.html", "2859"],
      ["walgreens.com", "https://www.walgreens.com/locator/walgreens-1332+n+highland+ave-jackson-tn-38301/id=13659", "13659"],
      ["kroger.com", "https://www.kroger.com/stores/grocery/tn/lewisburg/lewisburg/026/00534?cid=x", "00534"],
      ["kohls.com", "https://www.kohls.com/stores/tn/smyrna-1197.shtml", "1197"],
      ["dollargeneral.com", "https://www.dollargeneral.com/store-directory/tn/adamsville/24962", "24962"],
      ["tractorsupply.com", "https://www.tractorsupply.com/tsc/store_Bristol-TN-37620_3180", "3180"],
      ["mcdonalds.com", "https://www.mcdonalds.com/us/en-us/location/tn/parsons/346-tennessee-ave-n/36070.html?cid=x", "36070"],
    ];
    for (const [domain, url, expected] of cases) {
      expect(storeNumberFromWebsite(url, domain), `${domain} ${url}`).toBe(expected);
    }
  });

  it("returns null for non-store URLs (no false positives)", () => {
    // product / homepage pages
    expect(storeNumberFromWebsite("https://www.homedepot.com/services/c/garage-door/685fddfb6", "homedepot.com")).toBeNull();
    expect(storeNumberFromWebsite("https://www.lowes.com/pd/Timberwall/1000208625", "lowes.com")).toBeNull();
    expect(storeNumberFromWebsite("http://www.target.com", "target.com")).toBeNull();
    // generic locators / address slugs that must NOT be mistaken for a store id
    expect(storeNumberFromWebsite("https://www.starbucks.com/store-locator?map=39.6,-101.3,5z", "starbucks.com")).toBeNull();
    expect(storeNumberFromWebsite("https://www.cicis.com/locations/tn-nashville-5735-nolensville-pike", "cicis.com")).toBeNull();
    expect(storeNumberFromWebsite("https://www.zaxbys.com/locations/tn/nashville/5228-nolensville-pike/", "zaxbys.com")).toBeNull();
    expect(storeNumberFromWebsite("https://www.autozone.com/locations/tn/clarksville/1959-madison-st.html", "autozone.com")).toBeNull();
  });

  it("returns null for unknown domains or missing url", () => {
    expect(storeNumberFromWebsite("https://example.com/store/5", "example.com")).toBeNull();
    expect(storeNumberFromWebsite(undefined, "homedepot.com")).toBeNull();
  });
});
