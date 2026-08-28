const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a parts-pricing research tool for an auto parts shop in Brasília, Brazil. The shop, run by Nick, mainly sells oil filters, air filters, cabin filters, and brake pads, both to consumers and to other shops/stores (wholesale).

Given a part description or SKU and a quantity, use web search to do ALL of the following:

1. Identify the specific part being asked about. If the query is ambiguous (e.g. no vehicle model given for a filter), pick the most common/likely match and say so in "part_matched" and note the assumption in "caveats". Do not silently guess without flagging it.
2. Find the cheapest genuine source price for this part per unit, checking BOTH Brazilian domestic suppliers/wholesalers AND international sources in any country (e.g. US, China, elsewhere) — whichever is genuinely cheaper once basic shipping/import realities are accounted for. State which one won and why in "cost_source".
3. If the winning source is international, find the current relevant exchange rate to BRL and convert. If domestic, no conversion needed (state rate as null).
4. Separately, find a real competitor price for the same part from an auto parts provider/supplier in Brasília (a different one from your chosen cost source if possible) — this represents what Nick's competitor charges.
5. Note if bulk/quantity pricing appears to be available for this part from the source you found, and roughly at what quantity breakpoints, if discoverable. If not discoverable, say so honestly.
6. If you cannot find a genuine, verifiable price for something, do NOT invent one — set the relevant field to null and explain in "caveats" rather than guessing. If the vehicle/part isn't realistically sold or sourced in Brazil, say so plainly instead of forcing a number.

Calculations:
- cost_price_brl_per_unit = the winning source's unit price converted to BRL (or null if unknown)
- nick_price_brl_per_unit = cost_price_brl_per_unit * 1.45 (a 45% markup on cost) — null if cost unknown
- competitor_price_brl_per_unit = the Brasília competitor's unit price in BRL — null if unknown
- undercut_flag = true only if competitor_price_brl_per_unit is at least 20% LOWER than nick_price_brl_per_unit. Otherwise false.

Respond with ONLY raw JSON, no markdown formatting, no code fences, no prose before or after. Use exactly this schema:

{
  "part_matched": "string",
  "quantity": number,
  "cost_price_brl_per_unit": number or null,
  "cost_source": "string",
  "exchange_rate_used": "string or null",
  "nick_price_brl_per_unit": number or null,
  "competitor_price_brl_per_unit": number or null,
  "competitor_source": "string",
  "undercut_flag": boolean,
  "bulk_pricing_note": "string",
  "caveats": "string",
  "sources": [{"label": "string", "url": "string"}]
}`;

app.post('/api/quote', async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Set it in your hosting environment variables.' });
  }

  const { part, quantity } = req.body;
  if (!part || typeof part !== 'string' || !part.trim()) {
    return res.status(400).json({ error: 'Part description or SKU is required.' });
  }
  const qty = parseInt(quantity) || 1;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Part or SKU: ${part}\nQuantity: ${qty}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `Anthropic API error: ${response.status} ${errText}` });
    }

    const data = await response.json();
    const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
    const rawText = textBlocks.join('\n').trim();

    let clean = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      return res.status(502).json({ error: 'Could not parse a result from the model. Try rephrasing the part.' });
    }
    clean = clean.substring(firstBrace, lastBrace + 1);

    const result = JSON.parse(clean);
    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Nick's pricing tool running on port ${PORT}`);
});
