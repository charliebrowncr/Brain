CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, pregunta TEXT, respuesta TEXT);
CREATE TABLE IF NOT EXISTS conversaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, reserva TEXT, pregunta TEXT, respuesta TEXT, fecha TEXT);
INSERT INTO knowledge (pregunta, respuesta) VALUES ('Entrada', 'Tomar la entrada frente a Mystic Sushi o la entrada de Invictus.');
