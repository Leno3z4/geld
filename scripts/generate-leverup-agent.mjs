import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("LeverUp hosted-agent address:");
console.log(account.address);
console.log("");
console.log("Store this private key ONLY as a server/Cloudflare secret.");
console.log("Never commit it and never paste it into chat.");
console.log("");
console.log("LEVERUP_AGENT_PRIVATE_KEY:");
console.log(privateKey);
