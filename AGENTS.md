<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Cerberus architecture
- Keep public exchange ingestion client-side, with pure quantitative helpers and a separate Deribit block-feed module so instrument normalization is independently testable.
- Treat public book walls and trade correlations as anonymous behavioral candidates, never firm identities or proof of manipulation.
- Show idealized gross spread capture separately from signed basis contribution and mark-to-market P&L; midpoint fills cannot establish live profitability.
- Use canonical SHA-256 session ledger rows with previous hashes and serialize asynchronous hashing; a bounded in-memory chain is not immutable storage or regulatory certification.
- Deribit tape lists deduplicated block legs with shared block IDs; inverse BTC futures amounts are USD notional and options use BTC underlying exposure, not premium or delta risk.
