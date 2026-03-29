import axios from "axios";
async function run() {
  const HL_INFO = "https://api.hyperliquid.xyz/info";
  for (const user of ["0x9Bda49389B29Fa4E204eD9De8f3d7d06f84dA171", "0x09eE47977167eF955960761cAd68Bd0E3439C8F8"]) {
    try {
      const { data } = await axios.post(HL_INFO, { type: "clearinghouseState", user });
      const val = data?.crossMarginSummary?.accountValue || "0";
      console.log(user, "Value:", val);
    } catch(e: any) {
      console.error(user, e.message);
    }
  }
}
run();
