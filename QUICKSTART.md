# Quick Start Guide: Real Historical Data

Get the LP Address Activity chart working with real on-chain data in 5 minutes.

## Prerequisites

- Node.js 18+
- pnpm
- PostgreSQL (or use free tier from Supabase/Neon)

## Step 1: Set Up Database (2 minutes)

### Option A: Local PostgreSQL
```bash
# Install PostgreSQL (macOS)
brew install postgresql
brew services start postgresql

# Create database
createdb envio_indexer
```

### Option B: Supabase (Free)
1. Go to https://supabase.com
2. Create new project
3. Copy connection string from Settings → Database

## Step 2: Configure Indexer (1 minute)

```bash
cd indexer

# Create .env file
cat > .env << EOF
DATABASE_URL=postgresql://localhost/envio_indexer
# Or your Supabase URL:
# DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
EOF

# Install dependencies
pnpm install
```

## Step 3: Start Indexer (30 seconds)

```bash
pnpm envio dev
```

Wait for output:
```
✓ Indexer started
✓ GraphQL API: http://localhost:8080/v1/graphql
⏳ Syncing blocks...
```

## Step 4: Configure Frontend (30 seconds)

```bash
# In project root (not indexer/)
cd ..

# Create .env.local
echo "NEXT_PUBLIC_ENVIO_GRAPHQL_ENDPOINT=http://localhost:8080/v1/graphql" > .env.local
```

## Step 5: Start Frontend (30 seconds)

```bash
pnpm dev
```

Open http://localhost:3000

## Step 6: Use Real Data (30 seconds)

1. Navigate to dashboard
2. Scroll to "Market Maker Filter" section
3. Check ✅ "Use Real Data"
4. Select time range (e.g., "1 Day")
5. (Optional) Enter a market maker address
6. Chart updates with real historical data! 🎉

## Verify It's Working

### Check Indexer Status
```bash
curl http://localhost:8080/v1/graphql
# Should return HTML (GraphQL playground)
```

### Test GraphQL Query
Open http://localhost:8080/v1/graphql and run:

```graphql
{
  Candle(limit: 5, order_by: { timestamp: desc }) {
    timestamp
    close
  }
}
```

Should return recent candles.

### Check Frontend
- Browser console should show GraphQL requests
- Chart should display real price data
- No "Loading..." stuck state

## Troubleshooting

### Indexer won't start
```bash
# Check PostgreSQL is running
psql -l

# Check .env file exists
cat indexer/.env

# Check for port conflicts
lsof -i :8080
```

### Frontend shows "Loading..."
```bash
# Verify endpoint is set
cat .env.local

# Check indexer is running
curl http://localhost:8080/v1/graphql

# Check browser console for errors
```

### No data in chart
```bash
# Check if indexer has synced any blocks
# Look for "Synced to block X" in indexer logs

# Query database directly
psql $DATABASE_URL -c "SELECT COUNT(*) FROM candle;"
```

## Finding Market Maker Addresses

To test with a real market maker address:

1. Open http://localhost:8080/v1/graphql
2. Run query:
```graphql
{
  LPPosition(
    where: { liquidity: { _gt: "0" } }
    order_by: { liquidity: desc }
    limit: 10
  ) {
    owner
    liquidity
  }
}
```
3. Copy an `owner` address
4. Paste into dashboard "Market Maker Address" field

## Next Steps

- ✅ Chart works with real data!
- 📖 Read `IMPLEMENTATION.md` for architecture details
- 🔧 Read `indexer/SETUP.md` for advanced configuration
- 🚀 Deploy to production (see `IMPLEMENTATION_SUMMARY.md`)

## Common Issues

### "Database connection failed"
- Check `DATABASE_URL` in `indexer/.env`
- Verify PostgreSQL is running
- Test connection: `psql $DATABASE_URL`

### "RPC error"
- Worldchain RPC might be rate-limited
- Check `indexer/config.yaml` for RPC URL
- Consider using a private RPC endpoint

### "CORS error"
- Indexer and frontend on different ports is OK
- If on different domains, configure CORS in Envio

### Indexer syncing slowly
- Normal for first sync (catching up from block 0)
- Monitor progress in logs
- Consider setting higher `start_block` in `config.yaml`

## Success Criteria

You know it's working when:
- ✅ Indexer logs show "Synced to block X"
- ✅ GraphQL playground returns data
- ✅ Frontend chart shows real candles
- ✅ LP ranges appear when address is entered
- ✅ Time range selector changes data

## Get Help

If stuck:
1. Check indexer logs for errors
2. Test GraphQL queries directly
3. Check browser console
4. Review `IMPLEMENTATION.md`
5. Verify all environment variables are set

---

**Total setup time: ~5 minutes** ⚡

Enjoy your real-time historical data! 🎉
