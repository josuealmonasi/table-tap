// ============================================================================
// Where the development server is.
//
// Port 3000 unless DEV_URL says otherwise. More than one agent works on this
// repo, each with its own `next dev`; whoever holds 3000 first keeps it, and
// the gates follow the other one wherever it was started:
//
//   pnpm dev -p 3100
//   DEV_URL=http://localhost:3100 pnpm api
//
// Every gate that talks to the dev server reads it from here, so none can be
// left pointing at somebody else's server.
// ============================================================================
export const DEV_URL = (process.env.DEV_URL ?? "http://localhost:3000").replace(/\/$/, "");
