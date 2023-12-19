// Application Entry point, all packages are imported
//Imports from external packages
import "dotenv/config";
import path from "path";
import express from "express";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import cors from "cors";
import passport from "passport";
import session from "express-session";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
//import middleware
import { corsOptions } from "./config/corsOptions.js";
import { logger, logEvents } from "./middlewares/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
// import from application
import { connectDB } from "./config/dbConn.js";
//imports route
import defaultRoutes from "./routes/index.js";
import userRoutes from "./routes/userRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import apiRoutes from "./routes/apiRoutes.js";
//events
// import { onConnection } from "./events/onConnection.js";
import { socketCorsOption } from "./config/corsOptions.js";
import { saveData } from "./utils/saveData.js";
import { events } from "./utils/constant.js";

//constant
connectDB();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
	cors: socketCorsOption,
	allowEIO3: true,
});

// httpServer.listen(3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(logger);
app.use(cors(corsOptions));
app.use("/", express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(cookieParser());
app.use(
	session({
		secret: "keyboard cat",
		resave: false,
		saveUninitialized: false,
	})
);
app.use(passport.initialize());
app.use(passport.session());

// App Routes
app.use("/", defaultRoutes);
app.use("/api/user", userRoutes);
app.use("/api/auth", authRoutes);
//App Admin Routes
app.use("/api/admin", adminRoutes);
app.use("/api", apiRoutes);

// catch all route
app.all("*", (req, res) => {
	res.status(404);
	if (req.accepts("html")) {
		res.sendFile(path.join(__dirname, "views", "404.html"));
	} else if (req.accepts("json")) {
		res.json({ message: "404 Not Found" });
	} else {
		res.type("txt").send("404 Not Found");
	}
});

// socket events
const socketByUser = {};
const dataChunks = {};

io.use((socket, next) => {
	const { username } = socket.handshake.auth;
	const { sessionRoom } = socket.handshake.auth;

	if (!username && !sessionRoom) {
		return next(new Error("invalid username and SessionRoom"));
	}
	if (username && sessionRoom) {
		socket.username = username;
		socket.sessionRoom = sessionRoom;
		return next();
	}
});

io.on("connection", (socket) => {
	const room = socket.sessionRoom;
	// const { username } = socket;
	socket.join(room);

	io.in(room).emit(events.JOIN_ROOM_MESSAGE, {
		message: `Name:${socket.username} has joined the notary session, Room:${room}`,
	});

	socket.on("screenData:start", ({ data, username }) => {
		console.log(dataChunks);
		if (dataChunks[username]) {
			dataChunks[username].push(data);
		} else {
			dataChunks[username] = [data];
		}
	});

	socket.on("screenData:end", (username) => {
		if (dataChunks[username] && dataChunks[username].length) {
			saveData(dataChunks[username], username);
			dataChunks[username] = [];
		}
	});
	// socket.on("screenData:start", ({ data, session_id, session_title }) => {
	//   console.log(dataChunks);
	//   if (dataChunks[session_title + session_id]) {
	//     dataChunks[session_title + session_id].push(data);
	//   } else {
	//     dataChunks[session_title + session_id] = [data];
	//   }
	// });

	// socket.on("screenData:end", ({ session_id, session_title }) => {
	//   if (
	//     dataChunks[session_title + session_id] &&
	//     dataChunks[session_title + session_id].length
	//   ) {
	//     saveData(
	//       dataChunks[session_title + session_id],
	//       session_title + session_id
	//     );
	//     dataChunks[session_title + session_id] = [];
	//   }
	// });

	socket.on(events.NOTARY_AVAILABLE, (data) => {
		socket.to(room).emit(events.NOTARY_AVAILABLE, data);
	});
	socket.on(events.NOTARY_SEND_TOOLS, (data) => {
		socket.to(room).emit(events.NOTARY_SEND_TOOLS, data);
	});
	socket.on(events.NOTARY_EDIT_TOOLS, (data) => {
		socket.to(room).emit(events.NOTARY_EDIT_TOOLS, data);
	});
	socket.on(events.NOTARY_DELETE_TOOLS, (data) => {
		socket.to(room).emit(events.NOTARY_DELETE_TOOLS, data);
	});
	socket.on(events.NOTARY_COMPLETE_SESSION, () => {
		socket.to(room).emit(events.NOTARY_COMPLETE_SESSION);
	});
	socket.on("UPDATE_DOCUMENT_DISPLAYED", (data) => {
		// console.log(data);
		io.emit("UPDATE_DOCUMENT_DISPLAYED", data);
	});
	socket.on(events.NOTARY_CANCEL_SESSION, () => {
		socket.to(room).emit(events.NOTARY_CANCEL_SESSION);
	});
	socket.on(events.REMOVE, (data) => {
		socket.to(room).emit(events.REMOVE, data);
	});
	socket.on("disconnect", (reason) => {
		const username = socketByUser[socket.id];
		if (dataChunks[username] && dataChunks[username].length) {
			saveData(dataChunks[username], username);
			dataChunks[username] = [];
		}
		if (reason === "io server disconnect") {
			socket.connect();
		}
	});
});

mongoose.connection.once("open", () => {
	httpServer.listen(process.env.PORT, () => {
		console.log("Connected to MongoDB");
		console.log(`Server running on port ${process.env.PORT}`);
	});
});

mongoose.connection.on("error", (err) => {
	// console.log(err);
	logEvents(
		`${err.no}: ${err.code}\t${err.syscall}\t${err.hostname}`,
		"mongoErrLog.log"
	);
});

app.use(errorHandler);
