const http = require('http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const cors = require('cors');
const geoip = require('geoip-lite');
const fs = require('fs');
const path = require('path');



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
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      surname TEXT NOT NULL,
      accessLevel INTEGER,
      email TEXT NOT NULL,
      dateCreate DATETIME,
      icon TEXT
    )
  `);
});

    
const io =  socketIo(server, {
    cors:{
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
    }
});


const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}


io.on('connection', (socket) => {
  console.log('connected client');


  socket.on('uploadImage', ({ filename, base64data, userId}) => {
    const filePath = path.join(uploadDir, filename);
    const imageBuffer = Buffer.from(base64data, 'base64');

    fs.writeFile(filePath, imageBuffer, (err) => {
      if (err) {
        console.error(err.message);
        socket.emit('uploadError', { error: 'Помилка при завантаженні зображення' });
      } else {
        socket.emit('uploadSuccess', { message: 'Зображення успішно завантажено' });
       
        const iconFilename = filename;

        db.run('UPDATE users SET icon = ? WHERE id = ?', [iconFilename, userId], (dbErr) => {
          if (dbErr) {
            console.error(dbErr.message);
            socket.emit('uploadError', { error: 'Помилка при оновленні зображення користувача' });
          } else {
            socket.emit('updateIcon', { icon: iconFilename });
          }
        });
      }
    });
  });

  socket.on('requestImage', (data) => {
    const userId = data

    db.get('SELECT icon FROM users WHERE id = ?', [userId], (dbErr, row) => {
      if (dbErr) {
        console.error(dbErr.message);
        socket.emit('imageError', { error: 'Помилка при отриманні зображення користувача' });
      } else {
        if (!row || !row.icon) {
          socket.emit('imageError', { error: 'Зображення користувача не знайдено' });
        } else {

          const filename = row.icon;
    const imagePath = path.join(uploadDir, filename);
  
    fs.readFile(imagePath, (err, data) => {
      if (err) {
        console.error(err.message);
        socket.emit('imageError', { error: 'Помилка при отриманні зображення' });
      } else {
        const base64data = data.toString('base64');
        socket.emit('imageData', { filename, base64data });
      }
    });
        }
      }
    });

    
  });


  socket.on('message', (data) => {
    console.log(`message: ${data}`);
  });
  
  const ip = socket.request.headers['x-forwarded-for'] || socket.request.connection.remoteAddress;

  const geo = geoip.lookup('185.19.6.123'); //IP
  let country;
  if (geo && geo.country) {
    country = geo.country;
  } else {
    country = 'Unknown';
  }

  socket.emit('country', { country });


  socket.on('login', async ({ login, password }) => {
    try {
      const user = await getUserByLogin(login);

      if (!user) {
        socket.emit('loginError', 'Користувача не знайдено');
        return;
      }

      if (await bcrypt.compare(password, user.password)) {
        socket.emit('loginSuccess', user);
      } else {
        socket.emit('loginError', 'Невірний пароль');
      }
    } catch (error) {
      console.error(error);
      socket.emit('loginError', 'Помилка авторизації');
    }
  });

  socket.on('register', async (userData) => {
    try {
      const existingUser = await getUserByLogin(userData.login);

      if (existingUser) {
        socket.emit('registerError', 'Користувач з таким логіном вже існує');
        return;
      }

      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const newUser = { ...userData, password: hashedPassword };

      db.run(
        'INSERT INTO users (login, password, name, surname, accessLevel, email, dateCreate, icon) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newUser.login,
          newUser.password,
          newUser.name,
          newUser.surname,
          newUser.accessLevel || 0,
          newUser.email,
          new Date().toISOString(),
          newUser.icon || '',
        ],
        function (err) {
          if (err) {
            console.error(err.message);
            socket.emit('registerError', 'Помилка реєстрації');
          } else {
            newUser.id = this.lastID;
            socket.emit('registerSuccess', newUser);
          }
        }
      );
    } catch (error) {
      console.error(error);
      socket.emit('registerError', 'Помилка реєстрації');
    }
  });

  socket.on('get_users', () => {
    db.all('SELECT * FROM users', (err, rows) => {
      if (err) {
        console.error(err);
        return;
      }
      
      socket.emit('users_data', rows);
    });
  });
  socket.on('edit-user', (data) => {
    const { id, updates } = data;
  
    const updateFields = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  
    const stmt = db.prepare(`
      UPDATE users
      SET ${updateFields}
      WHERE id = ?
    `);
  
    const values = [...Object.values(updates), id];
  
    stmt.run(...values);
    stmt.finalize();
  });
  socket.on('delete-user', (id) => {
    db.run('DELETE FROM users WHERE id = ?', [id], (err) => {
      if (err) {
        console.error(err);
        return;
      }
    });
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
  const { id, updates } = data;

  const updateFields = Object.keys(updates).map((key) => `${key} = ?`).join(', ');

  const stmt = db.prepare(`
    UPDATE recipe
    SET ${updateFields}
    WHERE idrecipe = ?
  `);

  const values = [...Object.values(updates), id];

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


function getUserByLogin(login) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE login = ?', [login], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`server start on ${PORT}`);
});
