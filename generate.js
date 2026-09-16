// generate.js
// Génère un bloc de texte façon "neofetch" avec les stats GitHub de l'utilisateur
// et l'injecte dans README.md entre les marqueurs START_SECTION / END_SECTION.

const fs = require("fs");
const https = require("https");

const USERNAME = process.env.GH_USERNAME; // ton pseudo GitHub
const TOKEN = process.env.GH_TOKEN;        // token fourni automatiquement par Actions (ou PAT)

if (!USERNAME || !TOKEN) {
  console.error("GH_USERNAME et GH_TOKEN doivent être définis.");
  process.exit(1);
}

function ghRequest(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.github.com",
      path,
      headers: {
        "User-Agent": "readme-neofetch-generator",
        Authorization: `token ${TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    };
    https
      .get(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function ghGraphQL(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "User-Agent": "readme-neofetch-generator",
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Récupère tous les repos (pagination simple, jusqu'à 300 repos)
async function getAllRepos() {
  let repos = [];
  let page = 1;
  while (page <= 3) {
    const batch = await ghRequest(
      `/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

function pad(label, value, width = 28) {
  const dots = ".".repeat(Math.max(2, width - label.length));
  return `${label}: ${dots} ${value}`;
}

async function main() {
  const user = await ghRequest(`/users/${USERNAME}`);
  const repos = await getAllRepos();

  const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
  const totalRepos = repos.length;
  const followers = user.followers;
  const following = user.following;

  // Stats de contributions (commits, lignes ajoutées/supprimées) via GraphQL
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          totalCommitContributions
          restrictedContributionsCount
        }
      }
    }
  `;
  const gqlResult = await ghGraphQL(query);
  const contrib = gqlResult?.data?.user?.contributionsCollection;
  const totalCommits =
    (contrib?.totalCommitContributions || 0) +
    (contrib?.restrictedContributionsCount || 0);

  // Uptime depuis la création du compte
  const created = new Date(user.created_at);
  const now = new Date();
  let years = now.getFullYear() - created.getFullYear();
  let months = now.getMonth() - created.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  const days = Math.floor((now - created) / (1000 * 60 * 60 * 24)) % 30;

  const logo = `
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@@@%####%@@@@@@@@@@@@@@@@@@@
@@@@@@@@@@@@@#:      :=%@@@@@@@@@@@@@@@@
@@@@@@@@@@@@:           *@@@@@@@@@@@@@@@
@@@@@@@@@@@*             @@@@@@@@@@@@@@@
@@@@@@@@@@@#    .      :-@@@@@@@@@@@@@@@
@@@@@@@@@@*-   .=+:-*+#+=%@@@@@@@@@@@@@@
@@@@@@@@*.     =*@@@@@%-  *@@@@@@@@@@@@@
@@@@@@@*   -=+#@@@*%@@*-=:=@@@@@@@@@@@@@
@@@@@@=  :##  :-*%%%@@@@@@%%@@@@@@@@@@@@
@@@@@%*#%@@-      ==+@@@@#*+*@@@@@@@@@@@
@@@@@@@@@@#          -%@@%+##%%@@@@@@@@@
@@@@@@@@@@=           .#@@@@@%#@@@@@@@@@
@@@@@@@@@@-             =@@@#@#@@@@@@@@@
@@@@@@@@@@=              *%:.-#*%@@@@@@@
@@@@@@@@@@%.             ..    .:+@@@@@@
@@@@@@@@@@@#                   :+%@@@@@@
@@@@@@@@@@@@*                  -@@@@@@@@
@@@@@@@@@@@@@*              ==:*@@@@@@@@
@@@@@@@@@@@@@@+           -%@@@@@@@@@@@@`.replace(/^\n/, "");

  const lines = [
    `${USERNAME}@github`,
    "-".repeat(`${USERNAME}@github`.length + 2),
    pad("OS", "Arch Linux"),
    pad("Uptime", `${years} years, ${months} months, ${days} days`),
    pad("Host", user.company || "N/A"),
    "",
    pad("Contact.Email", user.email || "j.02ae@tutamail.com"),
    pad("Contact.Blog", user.blog || "N/A"),
    "",
    "GitHub Stats",
    "-".repeat(12),
    pad("Repos", `${totalRepos}`),
    pad("Stars", `${totalStars}`),
    pad("Commits (last yr)", `${totalCommits}`),
    pad("Followers", `${followers}`),
    pad("Following", `${following}`),
  ];

  const rightBlock = lines.join("\n");
  const leftLines = logo.split("\n");
  const rightLines = rightBlock.split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);

  let combined = "```text\n";
  for (let i = 0; i < maxLines; i++) {
    const left = (leftLines[i] || "").padEnd(38, " ");
    const right = rightLines[i] || "";
    combined += `${left}${right}\n`;
  }
  combined += "```";

  const readmePath = "README.md";
  let readme = fs.readFileSync(readmePath, "utf8");
  const startMarker = "<!--START_SECTION:neofetch-->";
  const endMarker = "<!--END_SECTION:neofetch-->";
  const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  const replacement = `${startMarker}\n${combined}\n${endMarker}`;

  if (regex.test(readme)) {
    readme = readme.replace(regex, replacement);
  } else {
    readme += `\n\n${replacement}\n`;
  }

  fs.writeFileSync(readmePath, readme);
  console.log("README mis à jour avec succès.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
