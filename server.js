// server.js
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// banco de dados
const DB_FILE = path.join(__dirname, "party.db");
const db = new sqlite3.Database(DB_FILE);

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
});

// login fixo admin
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin";
const ADMIN_TOKEN = "TOKEN_ADMIN_FIXO_123";

function isAdmin(req) {
  const auth = req.headers["authorization"] || "";
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: "Não autorizado" });
  }
  next();
}

// rota login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ token: ADMIN_TOKEN });
  }

  return res.status(401).json({ error: "Usuário ou senha inválidos" });
});

// listar itens (GET público)
app.get("/api/items", (req, res) => {
  db.all("SELECT id, name FROM items ORDER BY id", [], (err, rows) => {
    if (err) {
      console.error("Erro ao listar itens:", err);
      return res.status(500).json({ error: "Erro ao listar itens" });
    }
    res.json(rows);
  });
});

// criar item (apenas admin)
app.post("/api/items", requireAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome do item é obrigatório" });
  }
  const itemName = name.trim();
  db.run("INSERT INTO items (name) VALUES (?)", [itemName], function (err) {
    if (err) {
      console.error("Erro ao criar item:", err);
      return res.status(500).json({ error: "Erro ao criar item" });
    }
    res.status(201).json({ id: this.lastID, name: itemName });
  });
});

// deletar item (apenas admin)
app.delete("/api/items/:id", requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.run("DELETE FROM items WHERE id = ?", [id], function (err) {
    if (err) {
      console.error("Erro ao deletar item:", err);
      return res.status(500).json({ error: "Erro ao deletar item" });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Item não encontrado" });
    }
    res.json({ success: true });
  });
});

// listar sorteios (PÚBLICO - todo mundo vê)
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
    res.json(rows);
  });
});

// sortear item (com regras especiais para dois nomes)
app.post("/api/draw", (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Nome é obrigatório" });
  }
  const personName = name.trim();

  // 1) ver se já existe sorteio pra essa pessoa
  const sqlCheck = `
    SELECT d.id, i.id AS item_id, i.name AS item_name
    FROM draws d
    JOIN items i ON d.item_id = i.id
    WHERE d.person_name = ?
  `;
  db.get(sqlCheck, [personName], (err, row) => {
    if (err) {
      console.error("Erro ao verificar sorteio:", err);
      return res.status(500).json({ error: "Erro ao verificar sorteio" });
    }

    if (row) {
      // já tem item sorteado, devolve o mesmo
      return res.json({
        item: row.item_name,
        alreadyAssigned: true
      });
    }

    // 2) Tratamento especial para nomes fixos
    const normalizedName = personName.toLowerCase();
    let forcedItemName = null;

    if (normalizedName === "ana clara carriom") {
      forcedItemName = "Chester";
    } else if (normalizedName === "dione cleide") {
      forcedItemName = "Lasanha";
    }

    if (forcedItemName) {
      // tenta achar o item correspondente no banco
      db.get(
        "SELECT id, name FROM items WHERE LOWER(name) = LOWER(?) LIMIT 1",
        [forcedItemName],
        (errItem, itemRow) => {
          if (errItem) {
            console.error("Erro ao buscar item fixo:", errItem);
            return res.status(500).json({ error: "Erro ao buscar item" });
          }
          if (!itemRow) {
            // item não cadastrado ainda
            return res.status(400).json({
              error: `O item fixo "${forcedItemName}" ainda não foi cadastrado. Peça para o admin cadastrar esse item.`
            });
          }

          // salva sorteio com o item fixo
          db.run(
            "INSERT INTO draws (person_name, item_id) VALUES (?, ?)",
            [personName, itemRow.id],
            function (errInsert) {
              if (errInsert) {
                console.error("Erro ao salvar sorteio:", errInsert);
                return res.status(500).json({ error: "Erro ao salvar sorteio" });
              }
              return res.json({
                item: itemRow.name,
                alreadyAssigned: false
              });
            }
          );
        }
      );
      return; // não continua pro sorteio normal
    }

    // 3) Se não for nome especial, segue sorteio normal balanceado
    const sqlItems = `
      SELECT items.id, items.name, COUNT(draws.id) AS used_count
      FROM items
      LEFT JOIN draws ON items.id = draws.item_id
      GROUP BY items.id
      ORDER BY used_count ASC
    `;
    db.all(sqlItems, [], (errItems, items) => {
      if (errItems) {
        console.error("Erro ao buscar itens:", errItems);
        return res.status(500).json({ error: "Erro ao buscar itens" });
      }
      if (!items || items.length === 0) {
        return res.status(400).json({ error: "Nenhuma opção cadastrada ainda. Peça para o admin cadastrar." });
      }

      const minCount = items[0].used_count;
      const candidatos = items.filter(i => i.used_count === minCount);
      const sorteado = candidatos[Math.floor(Math.random() * candidatos.length)];

      db.run(
        "INSERT INTO draws (person_name, item_id) VALUES (?, ?)",
        [personName, sorteado.id],
        function (errInsert) {
          if (errInsert) {
            console.error("Erro ao salvar sorteio:", errInsert);
            return res.status(500).json({ error: "Erro ao salvar sorteio" });
          }
          return res.json({
            item: sorteado.name,
            alreadyAssigned: false
          });
        }
      );
    });
  });
});

// start
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
