const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');


const multer = require('multer');
const xlsx = require('xlsx');
const { connect } = require('http2');
require('dotenv').config();


function requireRole(...roles) {
  return (req, res, next) => {
      if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
          next();
      } else {
          res.status(403).send('Acceso denegado');
      }
  };
}
function requireLogin(req, res, next) {
  if (!req.session.user) {
      return res.redirect('/login.html');
  }
  next();
}
app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: false,
}));


app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());


const db = mysql.createConnection({
    host: process.env.DB_HOST,    
    user: process.env.DB_USER,      
    password: process.env.DB_PASSWORD,  
    database: process.env.DB_NAME    
});
 
db.connect(err => {
    if (err) {
      console.error('Error conectando a MySQL:', err);
      return;
    }
    console.log('Conexión exitosa a MySQL');
});


app.post('/registro', async (req, res) => {
  try {
      const { nombre_usuario, password, codigos_acceso } = req.body;

      // Validar datos recibidos
      if (!nombre_usuario || !password || !codigos_acceso) {
          return res.status(400).send('Datos incompletos');
      }

      // Consulta para verificar el código de acceso y obtener el tipo de usuario
      const [results] = await db.promise().query('SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?', [codigos_acceso]);

      if (results.length === 0) {
          return res.status(400).send('Código de acceso inválido');
      }

      const tipo_usuario = results[0].tipo_usuario; // Acceder al tipo de usuario correspondiente al código de acceso

      // Hashear la contraseña de manera asíncrona
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insertar usuario en la base de datos con el tipo de usuario
      const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
      await db.promise().query(insertUser, [nombre_usuario, hashedPassword, tipo_usuario]);

      res.redirect('/login.html');
  } catch (err) {
      console.error(err);
      res.status(500).send('Error al procesar la solicitud');
  }
});

app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;


  const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
  db.query(query, [nombre_usuario], (err, results) => {
      if (err) {
          return res.send('Error al obtener el usuario');
      }


      if (results.length === 0) {
          return res.send('Usuario no encontrado');
      }


      const user = results[0];


      const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
      if (!isPasswordValid) {
          return res.send('Contraseña incorrecta');
      }


      // Almacenar la información del usuario en la sesión
      req.session.user = {
          id: user.id,
          nombre_usuario: user.nombre_usuario,
          tipo_usuario: user.tipo_usuario
      };


      res.redirect('/');
  });
});


app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});


app.get('/buscar-biomedicos', requireLogin, requireRole('admin'), (req, res) => {
  const { nombre_biomed, correo, telefono } = req.query;
  let query = 'SELECT * FROM biomedico WHERE 1=1';


  if (nombre_biomed) {
    query += ` AND nombre_biomed LIKE '%${nombre_biomed}%'`;
  }
  if (correo) {
    query += ` AND correo = ${correo}`;
  }
  if (telefono) {
    query += ` AND telefono = ${telefono}`;
  }


  db.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }


    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Resultados de Búsqueda</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre dle biomedico</th>
              <th>Correo</th>
              <th>Telefono</th>
            </tr>
          </thead>
          <tbody>
    `;


    results.forEach(biomedico => {
      html += `
        <tr>
          <td>${biomedico.nombre_biomed}</td>
          <td>${biomedico.correo}</td>
          <td>${biomedico.telefono}</td>
        </tr>
      `;
    });


    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;


    res.send(html);
  });


});

app.get('/ordenar-fecha-registro', requireLogin, requireRole('admin', 'biomedico'), (req, res) => {
  const query = 'SELECT * FROM dispositivos ORDER BY fecha_registro DESC';


  db.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }


    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Dispositivos Ordenados</title>
      </head>
      <body>
        <h1>Dispositivos Ordenados por su fecha de registro</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre del dispositivo</th>
              <th>Fecha de registro</th>
              <th>Area</th>
            </tr>
          </thead>
          <tbody>
    `;


    results.forEach(dispositivos => {
      html += `
        <tr>
          <td>${dispositivos.nombre_disp}</td>
          <td>${dispositivos.fecha_registro}</td>
          <td>${dispositivos.area}</td>
        </tr>
      `;
    });


    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;


    res.send(html);
  });
});

app.post('/submit-data', requireLogin, requireRole('admin', 'biomedico'), (req, res) => {
  try {
    const { nombre_biomed, correo, telefono } = req.body;

    const query = 'INSERT INTO biomedico (nombre_biomed, correo, telefono) VALUES (?, ?, ?)';
    db.query(query, [nombre_biomed, correo, telefono], (err, result) => {
      if (err) {
        console.error('Error al insertar el biomedico:', err.message);  // Imprime el mensaje de error más claro
        return res.status(500).send('Error interno al insertar el biomedico: ' + err.message); // Agrega el mensaje de error
      }
      
      console.log('Biomedico insertado:', result);
      res.status(201).send('Biomedico guardado exitosamente.');
    });
    
  } catch (err) {
    console.error('Error en el bloque try-catch:', err.message);
    res.status(500).send('Error interno al insertar el biomedico: ' + err.message);
  }
});

app.post('/insertar-dispositivo', requireLogin, requireRole('admin', 'biomedico'), async (req, res) => {
  const { nombre_disp, nombre_biomed,  area, estudio, costo, marca, version } = req.body;
  const query = 'INSERT INTO dispositivos (nombre_disp, nombre_biomed, area, estudio, costo, marca, version) VALUES (?, ?, ?, ?, ?, ?, ?);';

  db.query(query, [nombre_disp,nombre_biomed, area, estudio, costo, marca, version], (err, result) => {
    if (err) {
      console.error('Error al ejecutar el query:', err);
      return res.send('Error al guardar los datos en la base de datos.');
    }

    let html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Dispositivos</title>
        <link rel="stylesheet" href="/styles.css">
      </head>
      <body>
        <h1>Dispositivos</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Nombre del biomedico</th>
              <th>Área</th>
              <th>Estudio</th>
              <th>Costo</th>
              <th>Marca</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${nombre_disp}</td>
              <td>${nombre_biomed}</td>
              <td>${area}</td>
              <td>${estudio}</td>
              <td>${costo}</td>
              <td>${marca}</td>
              <td>${version}</td>
            </tr>
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

app.get('/buscar-dispositivo', (req, res) => {
  const query = req.query.query;
  console.log('Consulta recibida:', query); // Verificar valor de la búsqueda
  const sql = `SELECT * FROM dispositivos WHERE nombre_disp LIKE ?`;
  db.query(sql, [`%${query}%`], (err, results) => {
    if (err) {
      console.error('Error en la búsqueda:', err);
      return res.status(500).json({ error: 'Error en la búsqueda' });
    }
    res.json(results);
  });
});

app.get('/ver-usuarios', requireLogin, requireRole('admin'), (req, res) => {
  const query = 'SELECT * FROM usuarios';
  db.query(query, (err, results) => {
      if (err) return res.send('Error al obtener usuarios');
      let html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <h1Usuarios</h1>
        <link rel="stylesheet" href="/styles.css">
     
        </head>
      <body>
       
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contraseña</th>
              <th>Tipo de usuario</th>
            </tr>
          </thead>
          <tbody>
    `;


    // Agrega las filas de la tabla dinámicamente
    results.forEach(usuarios => {
      html += `
        <tr>
          <td>${usuarios.nombre_usuario}</td>
          <td>${usuarios.password_hash}</td>
          <td>${usuarios.tipo_usuario}</td>
        </tr>
      `;
    });


    // Finaliza el HTML
    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;


    // Envía el HTML generado como respuesta
    res.send(html);


  });
});

app.post('/editar-dispositivos', requireLogin, requireRole('admin','biomedico'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editar_dispositivos.html'));
});

// Cambiar de POST a GET para la consulta de dispositivos
app.get('/obtener-dispositivos/:nombre_disp', (req, res) => {
  const { nombre_disp } = req.params;

  // Hacer una consulta a la base de datos para obtener el dispositivo
  const query = 'SELECT * FROM dispositivos WHERE nombre_disp = ?';
  db.query(query, [nombre_disp], (err, results) => {
    if (err) {
      console.error('Error al obtener el dispositivo:', err);  // Mejor logueo de errores
      return res.status(500).send('Error al obtener el dispositivo');
    }

    if (results.length === 0) {
      return res.status(404).send('Dispositivo no encontrado');
    }

    // Devolver los datos del dispositivo
    res.json(results[0]);
  });
});

// Ruta para eliminar un dispositivo
app.delete('/eliminar-dispositivos/:nombre_disp', (req, res) => {
  const { nombre_disp } = req.params;

  // Hacer una consulta a la base de datos para eliminar el dispositivo
  const query = 'DELETE FROM dispositivos WHERE nombre_disp = ?';
  db.query(query, [nombre_disp], (err, results) => {
    if (err) {
      console.error('Error al eliminar el dispositivo:', err);  // Mejor logueo de errores
      return res.status(500).send('Error al eliminar el dispositivo');
    }

    // Si no se afectaron filas, significa que no se encontró el dispositivo
    if (results.affectedRows === 0) {
      return res.status(404).send('Dispositivo no encontrado');
    }

    // Devolver una respuesta exitosa
    res.send('Dispositivo eliminado correctamente');
  });
});



app.get('/menu', (req, res) => {
  if (!req.session.user) {
    return res.status(401).send('Usuario no autenticado');
  }


  const menuItems = [];


  // Menú por defecto para todos los usuarios
  menuItems.push({ nombre: 'Inicio', url: '/index.html' });


  // Menú para 'admin'
  if (req.session.user.tipo_usuario === 'admin') {
    menuItems.push(
      { nombre: 'Ver Usuarios', url: '/ver-usuarios' },
      { nombre: 'Ordenar dispositivos por su fecha de registro', url: '/ordenar-fecha-registro' },
      { nombre: 'Cargar dispositivos', url: '/dispositivos.html' },
      { nombre: 'Añadir Usuario', url: '/usuarios.html' },
      { nombre: 'Editar dispositivos', url: '/editar_dispositivos.html' },
      { nombre: 'Descargar', url: '/descarga.html' },
      { nombre: 'Busqueda en tiempo real', url: '/busqueda_dispositivos.html' },
    );
  }

  // Menú para 'biomedico'
  if (req.session.user.tipo_usuario === 'biomedico') {
    menuItems.push(
      { nombre: 'Cargar dispositivos', url: '/dispositivos.html' },
      { nombre: 'Editar dispositivos', url: '/editar_dispositivos.html' },
      { nombre: 'To do list :)', url: '/to_do_list.html' },
      { nombre: 'Mis dispositivos', url: '/ver-mis-disp.html' },
    );
  }

  /// Menú común (Cerrar sesión)
  menuItems.push({ nombre: 'Cerrar Sesión', url: '/logout' });


  res.json(menuItems);
});


const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('excelFile'), (req, res) => {
  const filePath = req.file.path;
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);


  data.forEach(row => {
    const { nombre_disp, area, estudio, nombre_biomed, costo,version,  marca, mantenimiento} = row;
    const sql = `INSERT INTO dispositivos (nombre_disp, area, estudio, nombre_biomed, costo, version, marca, mantenimiento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [nombre_disp, area, estudio, nombre_biomed, costo, version, marca, mantenimiento], err => {
      if (err) throw err;
    });
  });


  res.send('<h1>Archivo cargado y datos guardados</h1><a href="/dispositivos.html">Volver</a>');
});


app.get('/download', (req, res) => {
  const sql = `SELECT * FROM dispositivos`;
  db.query(sql, (err, results) => {
    if (err) throw err;


    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'dispositivos');


    const filePath = path.join(__dirname, 'uploads', 'dispositivos.xlsx');
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, 'dispositivos.xlsx');
  });
});


app.get('/obtener-dispositivos/:nombre_disp', (req, res) => {
  const { nombre_disp } = req.params;

  // Buscar dispositivo por nombre
  const dispositivoEncontrado = dispositivos.find(d => d.nombre_disp === nombre_disp);

  if (dispositivoEncontrado) {
    res.json(dispositivoEncontrado);
  } else {
    res.status(404).send('Dispositivo no encontrado');
  }
});

app.delete('/eliminar-dispositivos/:nombre_disp', (req, res) => {
  const nombre_disp = req.params.nombre_disp;

  // Comprobamos si el dispositivo existe antes de intentar eliminarlo
  const checkQuery = `SELECT * FROM dispositivos WHERE nombre_disp = ?`;
  
  db.query(checkQuery, [nombre_disp], (err, results) => {
    if (err) {
      console.error('Error al verificar el dispositivo:', err);
      return res.status(500).send('Error al verificar el dispositivo.');
    }

    if (results.length === 0) {
      return res.status(404).send('Dispositivo no encontrado.');
    }

    // Si el dispositivo existe, procedemos a eliminarlo
    const deleteQuery = `DELETE FROM dispositivos WHERE nombre_disp = ?`;

    db.query(deleteQuery, [nombre_disp], (err, results) => {
      if (err) {
        console.error('Error al eliminar el dispositivo:', err);
        return res.status(500).send('Error al eliminar el dispositivo.');
      }

      // Si se eliminó correctamente
      res.status(200).send('Dispositivo eliminado correctamente.');
    });
  });
});
// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});


// Iniciar el servidor
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
