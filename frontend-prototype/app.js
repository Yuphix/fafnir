/**
 * Fafnir Bot Frontend - API Integration
 * Connects to Fafnir Bot API for trading operations
 */

class FafnirBotUI {
    constructor() {
        // Load configuration
        this.config = window.FAFNIR_CONFIG || {};
        this.apiBase = this.config.API?.BASE_URL || 'http://localhost:3001/api';
        this.wsUrl = this.config.API?.WS_URL || 'ws://localhost:3001';
        this.ws = null;
        this.isConnected = false;
        this.currentWallet = null;
        this.apiKey = null;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.addLog('Initializing Fafnir Bot UI...', 'info');
        this.checkAvailableWallets();
        await this.testConnection();
        this.connectWebSocket();
        await this.loadStrategies();
        await this.refreshStatus();
    }

    // Check which wallets are available
    checkAvailableWallets() {
        const metamaskBtn = document.getElementById('connectMetaMask');
        const galachainBtn = document.getElementById('connectGalaChain');

        // Check MetaMask availability
        if (!window.ethereum) {
            metamaskBtn.disabled = true;
            metamaskBtn.innerHTML = '🦊 Install MetaMask';
            metamaskBtn.onclick = () => {
                window.open('https://metamask.io/download/', '_blank');
            };
        }

        // Check Gala Wallet availability
        if (!window.gala) {
            galachainBtn.disabled = true;
            galachainBtn.innerHTML = '⚡ Install Gala Wallet';
            galachainBtn.onclick = () => {
                window.open('https://chromewebstore.google.com/detail/gala-wallet/enogcihmejeobfbnkkbcgcjffgdieaoj', '_blank');
            };
        }

        // Log available wallets
        const available = [];
        if (window.ethereum) available.push('MetaMask');
        if (window.galachain || window.gala) available.push('Gala Wallet');

        if (available.length > 0) {
            this.addLog(`🔍 Available wallets: ${available.join(', ')}`, 'info');
        } else {
            this.addLog('⚠️ No wallet extensions detected', 'warning');
        }
    }

    setupEventListeners() {
        // Wallet Connection
        document.getElementById('connectMetaMask').addEventListener('click', () => this.connectMetaMask());
        document.getElementById('connectGalaChain').addEventListener('click', () => this.connectGalaChain());
        document.getElementById('disconnectWallet').addEventListener('click', () => this.disconnectWallet());

        // Strategy Controls
        document.getElementById('startStrategy').addEventListener('click', () => this.startStrategy());
        document.getElementById('stopStrategy').addEventListener('click', () => this.stopStrategy());
        document.getElementById('refreshStatus').addEventListener('click', () => this.refreshStatus());

        // Configuration
        document.getElementById('saveConfig').addEventListener('click', () => this.saveConfiguration());
        document.getElementById('resetConfig').addEventListener('click', () => this.resetConfiguration());
        document.getElementById('aiAdvisor').addEventListener('change', () => this.toggleAIAdvisor());

        // Quick Actions
        document.getElementById('testConnection').addEventListener('click', () => this.testConnection());
        document.getElementById('viewBalances').addEventListener('click', () => this.viewBalances());
        document.getElementById('viewTrades').addEventListener('click', () => this.viewTrades());
        document.getElementById('emergencyStop').addEventListener('click', () => this.emergencyStop());

        // Logs
        document.getElementById('clearLogs').addEventListener('click', () => this.clearLogs());
        document.getElementById('exportLogs').addEventListener('click', () => this.exportLogs());

        // Modal
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
    }

    // API Helper Methods
    async apiCall(endpoint, method = 'GET', data = null) {
        try {
            const headers = {
                'Content-Type': 'application/json',
            };

            if (this.apiKey) {
                headers['x-api-key'] = this.apiKey;
            }

            const config = {
                method,
                headers,
            };

            if (data && method !== 'GET') {
                config.body = JSON.stringify(data);
            }

            const response = await fetch(`${this.apiBase}${endpoint}`, config);
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || `HTTP ${response.status}`);
            }

            return result;
        } catch (error) {
            this.addLog(`API Error: ${error.message}`, 'error');
            throw error;
        }
    }

    // Connection Management
    async testConnection() {
        try {
            this.updateConnectionStatus('Connecting...');
            const response = await this.apiCall('/dashboard');

            if (response.success) {
                this.isConnected = true;
                this.updateConnectionStatus('Connected');
                this.addLog('✅ API connection successful', 'success');
                return true;
            }
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus('Connection Failed');
            this.addLog(`❌ API connection failed: ${error.message}`, 'error');
            return false;
        }
    }

    connectWebSocket() {
        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                this.addLog('🔗 WebSocket connected', 'success');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.ws.onclose = () => {
                this.addLog('🔌 WebSocket disconnected', 'warning');
                // Attempt reconnection after 5 seconds
                setTimeout(() => this.connectWebSocket(), 5000);
            };

            this.ws.onerror = (error) => {
                this.addLog(`❌ WebSocket error: ${error}`, 'error');
            };
        } catch (error) {
            this.addLog(`❌ WebSocket connection failed: ${error.message}`, 'error');
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'bot_status':
                this.updateBotStatus(data.data);
                break;
            case 'trade_notification':
                this.addLog(`💰 Trade: ${data.data.message}`, 'success');
                break;
            case 'strategy_update':
                this.addLog(`⚙️ Strategy: ${data.data.message}`, 'info');
                break;
            case 'error':
                this.addLog(`❌ ${data.data.message}`, 'error');
                break;
        }
    }

    // Wallet Connection
    async connectMetaMask() {
        try {
            if (!window.ethereum) {
                throw new Error('MetaMask not found. Please install MetaMask extension.');
            }

            this.addLog('🦊 Connecting to MetaMask...', 'info');

            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            if (!accounts || accounts.length === 0) {
                throw new Error('No MetaMask accounts found');
            }

            const ethereumAddress = accounts[0];
            this.addLog(`✅ MetaMask connected: ${ethereumAddress}`, 'success');

            // Map to GalaChain address via API
            const mapping = await this.apiCall('/wallet/map-address', 'POST', {
                ethereumAddress: ethereumAddress
            });

            if (mapping.success) {
                this.currentWallet = {
                    type: 'metamask',
                    ethereumAddress: ethereumAddress,
                    galaChainAddress: mapping.data.galaChainAddress
                };

                this.updateWalletDisplay();
                this.addLog(`🔗 Mapped to GalaChain: ${mapping.data.galaChainAddress}`, 'success');
            }

        } catch (error) {
            this.addLog(`❌ MetaMask connection failed: ${error.message}`, 'error');
        }
    }

    async connectGalaChain() {
        try {
            // Check if Gala Wallet extension is available
            if (!window.gala) {
                throw new Error('Gala Wallet extension not found. Please install the Gala Wallet browser extension.');
            }

            this.addLog('⚡ Connecting to Gala Wallet...', 'info');

            // Request account access using the correct Gala Wallet API
            const galaWalletAccounts = await window.gala.request({
                method: "eth_requestAccounts",
            });

            if (!galaWalletAccounts || galaWalletAccounts.length === 0) {
                throw new Error('No accounts found in Gala Wallet');
            }

            const galaChainAddress = galaWalletAccounts[0];

            this.addLog(`✅ Gala Wallet connected: ${galaChainAddress}`, 'success');

            // For Gala Wallet, the address is already in GalaChain format
            this.currentWallet = {
                type: 'galachain',
                ethereumAddress: null, // Gala Wallet doesn't have Ethereum address
                galaChainAddress: galaChainAddress
            };

            this.updateWalletDisplay();
            this.addLog(`🔗 GalaChain address: ${galaChainAddress}`, 'success');

            // Authenticate with the API using GalaChain wallet
            await this.authenticateWithGalaWallet(galaChainAddress);

        } catch (error) {
            this.addLog(`❌ Gala Wallet connection failed: ${error.message}`, 'error');

            // Show helpful error message with installation link
            if (error.message.includes('not found')) {
                this.showModal('Gala Wallet Required',
                    '<p>To use GalaChain features, you need the Gala Wallet browser extension.</p>' +
                    '<p><a href="https://chromewebstore.google.com/detail/gala-wallet/enogcihmejeobfbnkkbcgcjffgdieaoj" target="_blank">' +
                    '📦 Install Gala Wallet Extension</a></p>' +
                    '<p>After installation, refresh this page and try again.</p>'
                );
            }
        }
    }

    disconnectWallet() {
        this.currentWallet = null;
        this.apiKey = null;
        this.hideWalletInfo();
        this.addLog('🔌 Wallet disconnected', 'info');
    }

    updateWalletDisplay() {
        if (this.currentWallet) {
            // Handle different wallet types
            const ethAddr = this.currentWallet.ethereumAddress || 'N/A';
            const galaAddr = this.currentWallet.galaChainAddress || 'N/A';

            document.getElementById('ethAddress').textContent = ethAddr;
            document.getElementById('galaAddress').textContent = galaAddr;

            // Show wallet type indicator
            const walletType = this.currentWallet.type === 'metamask' ? '🦊 MetaMask' : '⚡ Gala Wallet';

            // Update or create wallet type indicator
            let typeIndicator = document.getElementById('walletTypeIndicator');
            if (!typeIndicator) {
                typeIndicator = document.createElement('div');
                typeIndicator.id = 'walletTypeIndicator';
                typeIndicator.style.cssText = 'color: #00d4ff; font-weight: 600; margin-bottom: 10px;';
                document.querySelector('.wallet-info').insertBefore(typeIndicator, document.querySelector('.address-display'));
            }
            typeIndicator.textContent = `Connected via ${walletType}`;

            document.getElementById('walletInfo').style.display = 'block';
        }
    }

    hideWalletInfo() {
        document.getElementById('walletInfo').style.display = 'none';
        document.getElementById('ethAddress').textContent = '-';
        document.getElementById('galaAddress').textContent = '-';

        // Remove wallet type indicator
        const typeIndicator = document.getElementById('walletTypeIndicator');
        if (typeIndicator) {
            typeIndicator.remove();
        }
    }

    // Authenticate with Gala Wallet
    async authenticateWithGalaWallet(galaChainAddress) {
        try {
            this.addLog('🔐 Authenticating with Gala Wallet...', 'info');

            // Create authentication message
            const authMessage = {
                action: 'authenticate',
                address: galaChainAddress,
                timestamp: Date.now(),
                nonce: Math.random().toString(36)
            };

            // Sign the authentication message using personal_sign
            const signature = await window.gala.request({
                method: "personal_sign",
                params: [JSON.stringify(authMessage), galaChainAddress],
            });

            // Send authentication to API
            const authResponse = await this.apiCall('/auth/wallet', 'POST', {
                galaChainAddress: galaChainAddress,
                message: JSON.stringify(authMessage),
                signature: signature
            });

            if (authResponse.success && authResponse.data.apiKey) {
                this.apiKey = authResponse.data.apiKey;
                this.addLog('✅ GalaChain wallet authenticated successfully', 'success');

                // Refresh status with authenticated API key
                await this.refreshStatus();
            }

        } catch (error) {
            this.addLog(`❌ GalaChain authentication failed: ${error.message}`, 'error');
            // Continue without authentication - still show wallet connection
        }
    }

    // Strategy Management
    async loadStrategies() {
        try {
            const response = await this.apiCall('/strategies');
            const select = document.getElementById('strategySelect');

            select.innerHTML = '<option value="">Select a strategy...</option>';

            if (response.success && response.data) {
                response.data.forEach(strategy => {
                    const option = document.createElement('option');
                    option.value = strategy.id;
                    option.textContent = `${strategy.name} - ${strategy.description}`;
                    select.appendChild(option);
                });

                this.addLog(`📋 Loaded ${response.data.length} strategies`, 'info');
            }
        } catch (error) {
            this.addLog(`❌ Failed to load strategies: ${error.message}`, 'error');
        }
    }

    async startStrategy() {
        const strategyId = document.getElementById('strategySelect').value;
        if (!strategyId) {
            this.addLog('❌ Please select a strategy first', 'error');
            return;
        }

        try {
            this.addLog(`▶️ Starting strategy: ${strategyId}`, 'info');
            const response = await this.apiCall(`/strategies/${strategyId}/start`, 'POST');

            if (response.success) {
                this.addLog(`✅ Strategy started successfully`, 'success');
                await this.refreshStatus();
            }
        } catch (error) {
            this.addLog(`❌ Failed to start strategy: ${error.message}`, 'error');
        }
    }

    async stopStrategy() {
        const strategyId = document.getElementById('strategySelect').value;
        if (!strategyId) {
            this.addLog('❌ Please select a strategy first', 'error');
            return;
        }

        try {
            this.addLog(`⏹️ Stopping strategy: ${strategyId}`, 'info');
            const response = await this.apiCall(`/strategies/${strategyId}/stop`, 'POST');

            if (response.success) {
                this.addLog(`✅ Strategy stopped successfully`, 'success');
                await this.refreshStatus();
            }
        } catch (error) {
            this.addLog(`❌ Failed to stop strategy: ${error.message}`, 'error');
        }
    }

    // Status Updates
    async refreshStatus() {
        try {
            const [botStatus, config] = await Promise.all([
                this.apiCall('/bots/status'),
                this.apiCall('/config/summary')
            ]);

            if (botStatus.success) {
                this.updateBotStatus(botStatus.data);
            }

            if (config.success) {
                this.updateConfigDisplay(config.data);
            }

        } catch (error) {
            this.addLog(`❌ Failed to refresh status: ${error.message}`, 'error');
        }
    }

    updateBotStatus(data) {
        document.getElementById('botStatus').textContent = data.status || 'Unknown';
        document.getElementById('activeStrategy').textContent = data.activeStrategy || 'None';
        document.getElementById('balance').textContent = data.balance || '$0.00';
        document.getElementById('pnl').textContent = data.pnl || '+$0.00';
    }

    updateConfigDisplay(config) {
        if (config.minSwapAmount) {
            document.getElementById('minSwap').value = config.minSwapAmount;
        }
        if (config.maxSwapAmount) {
            document.getElementById('maxSwap').value = config.maxSwapAmount;
        }
        if (config.profitThreshold) {
            document.getElementById('profitThreshold').value = config.profitThreshold;
        }
        if (config.aiAdvisorEnabled !== undefined) {
            document.getElementById('aiAdvisor').checked = config.aiAdvisorEnabled;
        }
    }

    // Configuration Management
    async saveConfiguration() {
        try {
            const config = {
                minSwapAmount: parseFloat(document.getElementById('minSwap').value),
                maxSwapAmount: parseFloat(document.getElementById('maxSwap').value),
                profitThreshold: parseFloat(document.getElementById('profitThreshold').value),
                aiAdvisorEnabled: document.getElementById('aiAdvisor').checked
            };

            this.addLog('💾 Saving configuration...', 'info');
            const response = await this.apiCall('/config', 'PUT', config);

            if (response.success) {
                this.addLog('✅ Configuration saved successfully', 'success');
            }
        } catch (error) {
            this.addLog(`❌ Failed to save configuration: ${error.message}`, 'error');
        }
    }

    async resetConfiguration() {
        try {
            this.addLog('🔄 Resetting configuration to defaults...', 'info');
            const response = await this.apiCall('/config/reset', 'POST');

            if (response.success) {
                this.addLog('✅ Configuration reset successfully', 'success');
                await this.refreshStatus();
            }
        } catch (error) {
            this.addLog(`❌ Failed to reset configuration: ${error.message}`, 'error');
        }
    }

    async toggleAIAdvisor() {
        try {
            const enabled = document.getElementById('aiAdvisor').checked;
            this.addLog(`🤖 ${enabled ? 'Enabling' : 'Disabling'} AI Advisor...`, 'info');

            const response = await this.apiCall('/advisor/toggle', 'POST');

            if (response.success) {
                this.addLog(`✅ AI Advisor ${enabled ? 'enabled' : 'disabled'}`, 'success');
            }
        } catch (error) {
            this.addLog(`❌ Failed to toggle AI Advisor: ${error.message}`, 'error');
        }
    }

    // Quick Actions
        async viewBalances() {
        try {
            if (!this.currentWallet) {
                this.addLog('❌ Please connect a wallet first', 'error');
                return;
            }

            this.addLog('💰 Fetching wallet balances...', 'info');

            // Use the wallet check endpoint which handles both wallet types
            const response = await this.apiCall('/wallet/check-trading-readiness', 'POST', {
                ethereumAddress: this.currentWallet.ethereumAddress || '0x0000000000000000000000000000000000000000',
                galaChainAddress: this.currentWallet.galaChainAddress
            });

            if (response.success && response.readiness.balances) {
                let balanceText = `<h4>💼 ${this.currentWallet.type === 'metamask' ? 'MetaMask → GalaChain' : 'Gala Wallet'} Balances:</h4>`;
                balanceText += '<ul style="list-style: none; padding: 0;">';

                for (const [token, amount] of Object.entries(response.readiness.balances)) {
                    const displayAmount = typeof amount === 'number' ? amount.toFixed(4) : amount;
                    balanceText += `<li style="padding: 5px 0; border-bottom: 1px solid #333;">`;
                    balanceText += `<strong style="color: #00d4ff;">${token}:</strong> `;
                    balanceText += `<span style="float: right;">${displayAmount}</span></li>`;
                }
                balanceText += '</ul>';

                // Trading readiness info
                if (response.readiness.canTrade) {
                    balanceText += '<p style="color: #51cf66; margin-top: 15px;">✅ Ready for trading</p>';
                } else {
                    balanceText += '<p style="color: #ffd43b; margin-top: 15px;">⚠️ Trading setup needed</p>';
                    if (response.readiness.requiredActions && response.readiness.requiredActions.length > 0) {
                        balanceText += '<ul style="color: #ffd43b; margin-top: 10px;">';
                        response.readiness.requiredActions.forEach(action => {
                            balanceText += `<li>${action}</li>`;
                        });
                        balanceText += '</ul>';
                    }
                }

                this.showModal('Wallet Information', balanceText);
            } else {
                this.showModal('Wallet Balances', '<p>Unable to fetch balance information. Please ensure your wallet is properly connected.</p>');
            }
        } catch (error) {
            this.addLog(`❌ Failed to fetch balances: ${error.message}`, 'error');
        }
    }

    async viewTrades() {
        try {
            const response = await this.apiCall('/trades');

            if (response.success && response.data) {
                let tradesText = '<h4>Recent Trades:</h4>';
                if (response.data.length === 0) {
                    tradesText += '<p>No recent trades found.</p>';
                } else {
                    tradesText += '<ul>';
                    response.data.slice(0, 10).forEach(trade => {
                        tradesText += `<li><strong>${trade.type}:</strong> ${trade.amount} ${trade.token} - ${trade.status}</li>`;
                    });
                    tradesText += '</ul>';
                }

                this.showModal('Recent Trades', tradesText);
            }
        } catch (error) {
            this.addLog(`❌ Failed to fetch trades: ${error.message}`, 'error');
        }
    }

    async emergencyStop() {
        try {
            if (confirm('⚠️ Are you sure you want to perform an emergency stop? This will halt all trading immediately.')) {
                this.addLog('🚨 Initiating emergency stop...', 'warning');

                // Stop all strategies
                const strategies = await this.apiCall('/strategies');
                if (strategies.success) {
                    for (const strategy of strategies.data) {
                        await this.apiCall(`/strategies/${strategy.id}/stop`, 'POST');
                    }
                }

                this.addLog('🛑 Emergency stop completed', 'warning');
                await this.refreshStatus();
            }
        } catch (error) {
            this.addLog(`❌ Emergency stop failed: ${error.message}`, 'error');
        }
    }

    // UI Helper Methods
    updateConnectionStatus(status) {
        const indicator = document.getElementById('statusIndicator');
        const text = document.getElementById('statusText');

        text.textContent = status;

        if (status === 'Connected') {
            indicator.className = 'status-indicator online';
        } else {
            indicator.className = 'status-indicator offline';
        }
    }

    addLog(message, type = 'info') {
        const logsContent = document.getElementById('logsContent');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;

        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `
            <span class="log-time">${time}</span>
            <span class="log-message">${message}</span>
        `;

        logsContent.appendChild(entry);
        logsContent.scrollTop = logsContent.scrollHeight;

        // Keep only last 100 log entries
        while (logsContent.children.length > 100) {
            logsContent.removeChild(logsContent.firstChild);
        }
    }

    clearLogs() {
        document.getElementById('logsContent').innerHTML = '';
        this.addLog('📝 Logs cleared', 'info');
    }

    exportLogs() {
        const logs = document.getElementById('logsContent').innerText;
        const blob = new Blob([logs], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `fafnir-logs-${new Date().toISOString().split('T')[0]}.txt`;
        a.click();

        URL.revokeObjectURL(url);
        this.addLog('📥 Logs exported', 'success');
    }

    showModal(title, content) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('statusModal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('statusModal').style.display = 'none';
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.fafnirBot = new FafnirBotUI();
});

// Handle WebSocket reconnection on page focus
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && window.fafnirBot && !window.fafnirBot.ws) {
        window.fafnirBot.connectWebSocket();
    }
});
