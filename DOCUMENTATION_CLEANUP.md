# 📚 Documentation & Misc Files Cleanup

## 🗑️ **SAFE TO DELETE - Documentation & Misc Files**

### 📄 **Outdated/Redundant Documentation**
```bash
# Delete these outdated/superseded documentation files:
rm -f API_FRONTEND_INTEGRATION_README.md           # Superseded by FRONTEND_INTEGRATION_GUIDE.md
rm -f fafnir-24h-simulation.md                     # Old simulation results
rm -f optimal-pools-analysis.md                    # Outdated pool analysis
rm -f LOW_VOLUME_DEX_STRATEGIES.md                 # Deprecated strategies doc
rm -f STRATEGY_IMPROVEMENTS.md                     # Outdated improvements
rm -f TEST_STRATEGY_README.md                      # Redundant with code comments
rm -f STORY_GENERATION_API.md                      # Deprecated API docs
rm -f TRANSACTION_API_FOR_CONTENT_GENERATION.md    # Superseded by newer APIs
rm -f WEBSOCKET_API_DOCUMENTATION.md               # Outdated WebSocket docs
rm -f RPG_CLAUDE_EXAMPLE.md                        # Example file, not needed
```

### 📁 **Frontend Prototype Documentation**
```bash
# Delete redundant frontend documentation:
rm -f frontend-prototype/COMPLETE_HANDOVER_PACKAGE.md
rm -f frontend-prototype/DUAL_WALLET_SUMMARY.md
rm -f frontend-prototype/INTEGRATION_GUIDE.md
rm -f frontend-prototype/README.md
```

### 🗂️ **Config/Data Files**
```bash
# Delete config backups and test files:
rm -f config-backup.json                           # Backup file
rm -f api-keys.json                               # Should be in .env instead
rm -f cors-test.html                              # One-time test file
rm -f pool-discovery-results.json                 # Old discovery data
```

### 🐍 **Old JavaScript Files**
```bash
# Delete old JS implementations:
rm -f test-strategy-runner.js                     # Old JS implementation
rm -f test-fafnir-local.js                       # Local test file
rm -f ecosystem.config.js                        # Duplicate (keep .cjs version)
```

---

## ✅ **KEEP - Current Documentation**

### 📖 **Core Guides (Current & Accurate)**
```
✅ FRONTEND_INTEGRATION_GUIDE.md          # Main integration guide
✅ METAMASK_INTEGRATION_GUIDE.md          # MetaMask integration
✅ TRADING_BOT_DEVELOPMENT_GUIDE.md       # Development guide
✅ FAFNIR_TREASURE_HOARDER_STRATEGY.md   # Main strategy docs
✅ FAFNIR_STRATEGY_SUMMARY.md            # Strategy summary
✅ MULTI_USER_FRONTEND_INTEGRATION.md    # Multi-user integration
✅ MULTI_USER_ORACLE_SYSTEM.md           # Oracle system docs
✅ ORACLE_TRANSMISSION_SYSTEM.md         # Oracle technical docs
✅ CLAUDE_PROMPT_EXAMPLES.md             # AI prompts
✅ README.md                             # Main project README
```

### 📊 **Config Files (Keep)**
```
✅ config.json                           # Main trading config
✅ trading-config.json                   # Trading parameters
✅ tsconfig.json                         # TypeScript config
✅ package.json                          # Dependencies
✅ ecosystem.config.cjs                  # PM2 config (keep this one)
```

---

## 🔧 **PACKAGE.JSON CLEANUP**

### Remove These Broken Script References:
```json
// Delete these lines from package.json (files don't exist):
"test:buy-gala": "tsx src/test-buy-gala.ts",
"test:enhanced-trend": "tsx src/test-enhanced-trend.ts",
"dca:fib": "npx tsx src/dca-fibonacci-runner.ts",
"test:dca-fib": "npx tsx src/test-dca-fibonacci.ts",
"dashboard": "npx tsx src/web-dashboard-server.ts",
```

---

## 🚀 **SINGLE CLEANUP COMMAND**

Run this command to clean up all the documentation and misc files:

```bash
# Documentation cleanup
rm -f API_FRONTEND_INTEGRATION_README.md fafnir-24h-simulation.md optimal-pools-analysis.md LOW_VOLUME_DEX_STRATEGIES.md STRATEGY_IMPROVEMENTS.md TEST_STRATEGY_README.md STORY_GENERATION_API.md TRANSACTION_API_FOR_CONTENT_GENERATION.md WEBSOCKET_API_DOCUMENTATION.md RPG_CLAUDE_EXAMPLE.md

# Frontend docs cleanup
rm -f frontend-prototype/COMPLETE_HANDOVER_PACKAGE.md frontend-prototype/DUAL_WALLET_SUMMARY.md frontend-prototype/INTEGRATION_GUIDE.md frontend-prototype/README.md

# Config/data cleanup
rm -f config-backup.json api-keys.json cors-test.html pool-discovery-results.json

# Old JS files cleanup
rm -f test-strategy-runner.js test-fafnir-local.js ecosystem.config.js

echo "✅ Documentation cleanup complete!"
```

---

## 📋 **SUMMARY**

**Files to Delete**: 18 total
- 10 outdated/redundant .md files
- 4 frontend documentation files
- 4 config/data/JS files

**Files to Keep**: All current documentation, all source code, all Docker configs, all bot implementations, Raydium integration

**Manual Task**: Remove 5 broken script references from package.json

This focused cleanup will remove the clutter while keeping everything you need for multi-strategy trading and future Raydium expansion! 🧹✨

**After cleanup, your documentation will be clean and current with only the relevant guides that match your actual implementation.**
