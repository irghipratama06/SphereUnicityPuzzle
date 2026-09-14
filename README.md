# UCT Sphere Puzzle

A mobile-first 3×3 sliding puzzle for Unicity testnet. It uses the supplied UCT artwork, connects to Sphere Wallet with Sphere Connect, and asks the user to approve a UCT transfer to the configured game treasury before a round starts.

## What is included

- 3×3 sliding puzzle using `public/puzzle-image.jpeg`.
- Easy / Medium / Hard / Expert shuffle depth.
- All levels start with a 5 UCT suggested deposit; the player can increase the amount.
- Sphere Connect browser flow (iframe → extension → popup through `autoConnect`).
- Testnet2 target.
- UCT coinId is discovered from the connected wallet's `sphere_getAssets` response, so you do not have to hard-code a 64-hex coin ID.
- Transfer is an explicit Sphere `send` intent; the wallet shows its own approval UI.
- Responsive layout for phones.
- No private key is handled by this app.

## Important payment architecture note

This version implements the **entry/deposit transfer** to `VITE_GAME_TREASURY`. It does not claim automatic prize payout or on-chain escrow. If you want a true tournament/escrow economy (deposit → verified result → payout/refund), add a backend that verifies transfers and controls a dedicated game treasury. Do not put a private key or seed phrase in Vercel environment variables.

## Deploy with GitHub + Vercel (no terminal)

### 1. Put the project on GitHub from your phone

1. Create a new empty GitHub repository, for example `uct-sphere-puzzle`.
2. On GitHub, choose **Add file → Upload files**.
3. Upload the files/folders from this project. Keep `src/` and `public/` as folders.
4. Commit the files to `main`.

### 2. Import into Vercel

1. Open Vercel and choose **Add New → Project**.
2. Import the GitHub repository.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Add the environment variables below before deploying.

### 3. Vercel Environment Variables

Required:

- `VITE_GAME_TREASURY` = your Sphere testnet receiving address or nametag, e.g. `@your-game-treasury`
- `VITE_SPHERE_WALLET_URL` = `https://sphere.unicity.network`
- `VITE_SPHERE_NETWORK` = `testnet2`
- `VITE_UCT_DECIMALS` = `8`
- `VITE_MIN_STAKE_UCT` = `5`

After adding them, redeploy so Vite bakes the `VITE_*` values into the frontend build.

## Sphere connection behavior

The app uses `autoConnect()` from `@unicitylabs/sphere-sdk/connect/browser` and requests only the scopes needed for identity, token/balance reads, signing and transfer intents.

For a hosted Sphere wallet, the wallet's custom-agent iframe flow is the most reliable production path. The SDK Connect docs also document extension and popup fallback behavior.

## Security

- Never ask users for seed phrases or private keys.
- `VITE_GAME_TREASURY` is public frontend configuration, not a secret.
- Only use testnet UCT while validating the game.
- A transfer may be certified while delivery is still pending; the UI does not automatically re-send in that case.

## Customize

- Puzzle artwork: replace `public/puzzle-image.jpeg`.
- Suggested stake: edit `LEVELS` in `src/main.tsx`.
- Minimum stake: `VITE_MIN_STAKE_UCT`.
- Treasury: `VITE_GAME_TREASURY`.
- Brand/UI: `src/styles.css`.
