import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import os from "os";

// Let phones on the same Wi-Fi open the dev server by its LAN address (for the monitor QR code).
const lanIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);

export default function config(phase: string): NextConfig {
  return {
    // Self-contained server in .next/standalone, used by the Docker image.
    output: "standalone",
    poweredByHeader: false,
    allowedDevOrigins: lanIps,
    // `next dev` gets its own build folder, so running `next build` can't break a dev server that's running.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    async headers() {
      return [
        {
          source: "/:path*",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Frame-Options", value: "DENY" },
          ],
        },
      ];
    },
  };
}
