import "dotenv/config";
import http from "node:http";

/**
 * One-time helper to mint a Gmail read-only refresh token for the poller.
 * Prereq: create an OAuth client (type "Desktop app") in Google Cloud Console
 * and put its id/secret in .env as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
 * Then: `npm run auth-google`, approve in the browser, paste the printed
 * GOOGLE_REFRESH_TOKEN into .env.
 */
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.\n" +
      "Create them at console.cloud.google.com → APIs & Services → Credentials →\n" +
      "Create OAuth client ID → application type 'Desktop app'.",
  );
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

console.log("\n1) Open this URL in your browser and approve read-only Gmail access:\n");
console.log(authUrl + "\n");
console.log(`2) Waiting for the redirect on ${redirectUri} … (leave this running)`);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirectUri);
  const code = u.searchParams.get("code");
  const err = u.searchParams.get("error");

  if (err) {
    res.end(`Authorization failed: ${err}. You can close this tab.`);
    console.error("\nAuthorization failed:", err);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end("Waiting for authorization…");
    return;
  }

  try {
    const tokRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const data = (await tokRes.json()) as {
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokRes.ok || !data.refresh_token) {
      res.end("Token exchange failed — check the terminal.");
      console.error("\nToken exchange failed:", data.error ?? tokRes.status, data.error_description ?? "");
      console.error(
        "If there's no refresh_token, revoke this app at myaccount.google.com/permissions and retry —\n" +
          "Google only returns a refresh token on the first consent.",
      );
      server.close();
      process.exit(1);
    }

    res.end("Authorized. Refresh token captured — close this tab and return to the terminal.");
    console.log("\n✓ Success. Add this line to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
    console.log("Then run: npm run poll");
    server.close();
    process.exit(0);
  } catch (e) {
    res.end("Error — check the terminal.");
    console.error(e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT);
