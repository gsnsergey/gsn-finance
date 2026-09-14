-- accounts
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bank TEXT,
  type TEXT NOT NULL CHECK(type IN ('debit', 'credit', 'card', 'savings')),
  currency TEXT NOT NULL DEFAULT 'RUB',
  balance INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_accounts_archived ON accounts(archived);

-- categories
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
  color TEXT,
  icon TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_type ON categories(type);

-- transactions
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  categoryId TEXT,
  date TEXT NOT NULL,
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('agent', 'manual', 'import')),
  externalRef TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX idx_transactions_account ON transactions(accountId);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(categoryId);
CREATE INDEX idx_transactions_type ON transactions(type);

-- deposits
CREATE TABLE deposits (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL,
  name TEXT NOT NULL,
  principal INTEGER NOT NULL,
  rate REAL NOT NULL,
  openedAt TEXT NOT NULL,
  closedAt TEXT,
  capitalization INTEGER NOT NULL DEFAULT 0,
  payoutFrequency TEXT NOT NULL DEFAULT 'end' CHECK(payoutFrequency IN ('monthly', 'quarterly', 'end')),
  currentBalance INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_deposits_bank ON deposits(bank);
CREATE INDEX idx_deposits_closed ON deposits(closedAt);

-- holdings
CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  broker TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT,
  quantity REAL NOT NULL,
  avgPrice REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  accountId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE INDEX idx_holdings_broker ON holdings(broker);
CREATE INDEX idx_holdings_ticker ON holdings(ticker);

-- loans
CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL,
  name TEXT NOT NULL,
  principal INTEGER NOT NULL,
  remainingAmount INTEGER NOT NULL,
  rate REAL NOT NULL,
  monthlyPayment INTEGER NOT NULL,
  paymentDay INTEGER NOT NULL CHECK(paymentDay BETWEEN 1 AND 31),
  openedAt TEXT NOT NULL,
  closedAt TEXT,
  type TEXT NOT NULL CHECK(type IN ('consumer', 'mortgage', 'credit_line')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_loans_bank ON loans(bank);
CREATE INDEX idx_loans_type ON loans(type);

-- subscriptions
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  period TEXT NOT NULL CHECK(period IN ('monthly', 'yearly', 'weekly')),
  nextChargeDate TEXT NOT NULL,
  categoryId TEXT,
  autoDetected INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (categoryId) REFERENCES categories(id) ON DELETE SET NULL
);
CREATE INDEX idx_subscriptions_active ON subscriptions(active);
CREATE INDEX idx_subscriptions_next ON subscriptions(nextChargeDate);

-- obligations
CREATE TABLE obligations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  period TEXT NOT NULL CHECK(period IN ('monthly', 'quarterly', 'yearly')),
  nextDueDate TEXT NOT NULL,
  recipient TEXT,
  comment TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX idx_obligations_next ON obligations(nextDueDate);
