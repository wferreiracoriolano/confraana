// server.js - Roleta Confraternização (itens NÃO repetem)
// Regras:
// - Cada pessoa só pode sortear 1 vez (UNIQUE person_name)
// - Cada item só pode ser usado 1 vez (UNIQUE item_id via índice)
// - Sorteio escolhe apenas itens ainda não usados

const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Banco SQLite
const db = new sqlite3.Database(path.join(__dirname, "party.db"));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id)
    )
  `);

  // Garante que o MESMO item não seja usado por duas pessoas
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_draws_item_unique
    ON draws(item_id)
  `);
});

// LOGIN FIXO
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin";
const ADMIN_TOKEN = "TOKEN_ADMIN_123";

function isAdmin(req) {
  const auth = req.headers["authorization"] || "";
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "Não autorizado" });
  next();
}

// Login admin
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }
  return res.status(401).json({ error: "Usuário ou senha inválidos" });
});

// Itens (lista - usado no admin para ver/remover)
app.get("/api/items", (req, res) => {
  db.all("SELECT id, name FROM items ORDER BY id", [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar itens:", err);
      return res.status(500).json({ error: "Erro ao listar itens" });
    }
    return res.json(rows);
  });
});

// Criar item (admin)
app.post("/api/items", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do item é obrigatório" });
  }

  const itemName = name.trim();

  db.run("INSERT INTO items (name) VALUES (?)", [itemName], function (err) {
    if (err) {
      console.error("Erro ao inserir item:", err);
      return res.status(500).json({ error: "Erro ao inserir item" });
    }
    return res.json({ id: this.lastID, name: itemName });
  });
});

// Remover item (admin)
app.delete("/api/items/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);

  db.run("DELETE FROM items WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Erro ao remover item:", err);
      return res.status(500).json({ error: "Erro ao remover item" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Item não encontrado" });
    }
    return res.json({ success: true });
  });
});

// Sorteios (PÚBLICO - todos veem)
app.get("/api/draws", (req, res) => {
  const sql = `
    SELECT d.id, d.person_name, d.created_at, i.name AS item_name
    FROM draws d
    JOIN items i ON d.item_id = i.id
    ORDER BY d.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar sorteios:", err);
      return res.status(500).json({ error: "Erro ao listar sorteios" });
    }
    return res.json(rows);
  });
});

// Realizar sorteio (item não pode repetir)
app.post("/api/draw", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Digite seu nome." });
  }

  const personName = name.trim();

  // 1) Se a pessoa já sorteou, devolve o mesmo item
  const checkSql = `
    SELECT d.id, i.name AS item_name
    FROM draws d
    JOIN items i ON d.item_id = i.id
    WHERE d.person_name = ?
  `;

  db.get(checkSql, [personName], (err, row) => {
    if (err) {
      console.error("Erro ao verificar sorteio:", err);
      return res.status(500).json({ error: "Erro ao verificar sorteio" });
    }

    if (row) {
      return res.json({ item: row.item_name, alreadyAssigned: true });
    }

    // 2) Buscar apenas itens que NÃO foram usados ainda
    const sqlAvailable = `
      SELECT items.id, items.name
      FROM items
      LEFT JOIN draws ON items.id = draws.item_id
      WHERE draws.id IS NULL
    `;

    db.all(sqlAvailable, [], (err2, items) => {
      if (err2) {
        console.error("Erro ao buscar itens disponíveis:", err2);
        return res.status(500).json({ error: "Erro ao buscar itens disponíveis" });
      }

      if (!items || items.length === 0) {
        return res.status(400).json({
          error: "Todos os itens já foram sorteados. Peça para o admin cadastrar mais opções."
        });
      }

      // 3) Sorteio aleatório entre os disponíveis
      const sorteado = items[Math.floor(Math.random() * items.length)];

      // 4) Inserir no banco (o índice UNIQUE impede repetir item_id)
      db.run(
        "INSERT INTO draws (person_name, item_id) VALUES (?, ?)",
        [personName, sorteado.id],
        function (err3) {
          if (err3) {
            console.error("Erro ao salvar sorteio:", err3);
            return res.status(500).json({ error: "Erro ao salvar sorteio" });
          }
          return res.json({ item: sorteado.name, alreadyAssigned: false });
        }
      );
    });
  });
});

app.listen(PORT, () => {
  console.log("Rodando na porta " + PORT);
});
