const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const socketIo = require('socket.io');
const cors = require('cors');


const app = express();
app.use(cors());

const server = http.createServer(app);
const db = new sqlite3.Database('./db/dryengineer.sqlite');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS recipe (
      idrecipe INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      tempgrain INTEGER,
      tempgrainmax INTEGER,
      tempgraincritical INTEGER,
      tempagent INTEGER,
      tempagentcritical INTEGER,
      maxfanasprate INTEGER,
      maxfanrecrate INTEGER,
      timeunload INTEGER,
      timeunloaddelay INTEGER,
      weight INTEGER
    )
  `);
});

    
const io =  socketIo(server, {
    cors:{
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
    }
});


io.on('connection', (socket) => {
  console.log('connected client');

  socket.on('message', (data) => {
    console.log(`Message: ${data}`);
  });


  socket.on('get_listnames', () => {
    db.all('SELECT * FROM recipe', (err, rows) => {
      if (err) {
        console.error(err);
        return;
      }
      
      socket.emit('listnames_data', rows);
    });
  });


  socket.on('create-listname', (data) => {
    const {
      name,
      tempgrain,
      tempgrainmax,
      tempgraincritical,
      tempagent,
      tempagentcritical,
      maxfanasprate,
      maxfanrecrate,
      timeunload,
      timeunloaddelay,
      weight,
    } = data;

    const stmt = db.prepare(`
      INSERT INTO recipe (
        name,
        tempgrain,
        tempgrainmax,
        tempgraincritical,
        tempagent,
        tempagentcritical,
        maxfanasprate,
        maxfanrecrate,
        timeunload,
        timeunloaddelay,
        weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      name,
      tempgrain,
      tempgrainmax,
      tempgraincritical,
      tempagent,
      tempagentcritical,
      maxfanasprate,
      maxfanrecrate,
      timeunload,
      timeunloaddelay,
      weight
    );

    stmt.finalize();
  });



socket.on('edit-listname', (data) => {
  const { idrecipe, updates } = data;

  const updateFields = Object.keys(updates).map((key) => `${key} = ?`).join(', ');

  const stmt = db.prepare(`
    UPDATE recipe
    SET ${updateFields}
    WHERE idrecipe = ?
  `);

  const values = [...Object.values(updates), idrecipe];

  stmt.run(...values);
  stmt.finalize();
});

  socket.on('delete-listname', (idrecipe) => {
    db.run('DELETE FROM recipe WHERE idrecipe = ?', [idrecipe], (err) => {
      if (err) {
        console.error(err);
        return;
      }
    });
});

 
 socket.on('setCurrentUser', (user) => {
    currentUser = user;
    console.log(`Current user set for socket ${socket.id}:`, user);

    io.emit('setCurrentUser', user);
  });


  socket.on('disconnect', () => {
    console.log('Client disconnect');
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`server start on ${PORT}`);
});
