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
import { generatePDFAndSendEmail } from "./utils/generatePDFAndSendEmail.js";
import { events } from "./utils/constant.js";
import moment from "moment";
const dateTime = () => {
	return moment().format("Do MMM YYYY, h:mm:ss a");
};
const date = dateTime();

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
const currentTime = new Date().toLocaleTimeString(); // Get current time

io.use((socket, next) => {
	// console.log(socket.handshake.auth);
	const { username, token, sessionRoom, sessionTitle } = socket.handshake.auth;

	if (!username && !sessionRoom && !token) {
		return next(new Error("invalid username and SessionRoom"));
	}
	if (username && sessionRoom && token) {
		socket.username = username;
		socket.token = token;
		socket.sessionRoom = sessionRoom;
		socket.sessionTitle = sessionTitle;
		return next();
	}
});

io.on("connection", (socket) => {
	const room = socket.sessionRoom;
	const username = socket.username;
	const videoFile = socket.sessionTitle;
	const userToken = socket.token;
	// console.log(`User ${username} has joined session titled ${room}.`);
	console.log(`[${currentTime}] ${username} has joined session.`);

	socket.join(room);

	io.in(room).emit(events.JOIN_ROOM_MESSAGE, {
		message: `Name:${socket.username} has joined the session, Room:${room}`,
	});

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
	socket.on(events.DOC_OWNER_INVITE_PARTICIPANTS, (data) => {
		socket.to(room).emit(events.DOC_OWNER_INVITE_PARTICIPANTS, data);
	});
	socket.on(events.NOTARY_COMPLETE_SESSION, () => {
		socket.to(room).emit(events.NOTARY_COMPLETE_SESSION);
	});
	socket.on(events.NOTARY_CANCEL_SESSION, () => {
		socket.to(room).emit(events.NOTARY_CANCEL_SESSION);
	});
	socket.on(events.NOTARY_NEW_REQUEST, () => {
		socket.to(room).emit(events.NOTARY_NEW_REQUEST);
	});
	socket.on(events.REMOVE, (data) => {
		socket.to(room).emit(events.REMOVE, data);
	});

	socket.on("UPDATE_DOCUMENT_DISPLAYED", (data) => {
		// console.log(data);
		io.emit("UPDATE_DOCUMENT_DISPLAYED", data);
	});

	socket.on("request_sent", (data) => {
		const currentTime = new Date().toLocaleTimeString(); // Get current time
		console.log(`[${currentTime}] A request has been sent`, data);
		io.emit("request_sent", data);
	});
	socket.on("close_field", (data) => {
		const currentTime = new Date().toLocaleTimeString(); // Get current time
		console.log(`[${currentTime}] Field closed`, data);
		io.emit("close_field", data);
	});

	socket.on("RECORDING_CHUNK_EVENT", (data) => {
		console.log("File Received", data);
		if (dataChunks[username]) {
			dataChunks[username].push(data);
		} else {
			dataChunks[username] = [data];
		}
	});

	socket.on("RECORDING_END_EVENT", () => {
		console.log(
			`[${new Date().toLocaleString()}] Step 1: File Received from FrontEnd`
		);
		if (dataChunks[username] && dataChunks[username].length) {
			saveData(dataChunks[username], videoFile, room, userToken);
			dataChunks[username] = [];
		}
	});

	socket.on("generate_pdf_send_mail", (data) => {
		console.log("generate pdf and send mail", data);
		generatePDFAndSendEmail();
	});

	socket.on("RECORDING_START_SOUND", () => {
		io.in(room).emit("RECORDING_START_SOUND");
	});

	socket.on("RECORDING_STOP_SOUND", () => {
		io.in(room).emit("RECORDING_STOP_SOUND");
	});

	socket.on("SHOW_RECORDING_NOTICE", () => {
		// socket.to(room).emit("SHOW_RECORDING_NOTICE");
		io.in(room).emit("SHOW_RECORDING_NOTICE");
	});

	socket.on("SHOW_FEED_BACK", () => {
		io.in(room).emit("SHOW_FEED_BACK");
	});

	socket.on("CLOSE_ALL_VIDEO_FIELD", () => {
		io.in(room).emit("CLOSE_ALL_VIDEO_FIELD");
		console.log("field closed");
	});

	socket.on("SHOW_SESSION_TIME_ALERT", () => {
		io.in(room).emit("SHOW_SESSION_TIME_ALERT");
	});

	// SHOW_SESSION_TIME_ALERT

	socket.on("SHOW_COMPLETE_SESSION_NOTICE", () => {
		socket.to(room).emit("SHOW_COMPLETE_SESSION_NOTICE");
	});

	socket.on("disconnect", (reason) => {
		if (dataChunks[videoFile] && dataChunks[videoFile].length) {
			saveData(dataChunks[videoFile], videoFile);
			dataChunks[videoFile] = [];
		}
		if (reason === "io server disconnect") {
			socket.connect();
		}
	});
});

io.on("connection", (socket) => {});
httpServer.listen(process.env.PORT, () => {
	console.log("Connected to MongoDB");
	console.log(`Server running on port ${process.env.PORT}`);
});

app.use(errorHandler);
