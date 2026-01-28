const { io } = require("socket.io-client");

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NSwiZW1haWwiOiJwcmVzdGFkb3JAZ21haWwuY29tIiwicm9sZXMiOlsiUFJFU1RBRE9SIiwiT0NVUEFOVEUiXSwiaWF0IjoxNzY5MDMzMzcyLCJleHAiOjE3Njk2MzgxNzJ9.cne3HChtcYjtbp2SwQ5DdWwqfDqxv_etwe8L4tBiJpg";
const reservationId = 8;

const socket = io("http://127.0.0.1:4000", {
  path: "/socket.io",
  auth: { token },
  transports: ["websocket"], 
  timeout: 8000,
  reconnectionAttempts: 2,
});

socket.on("connect", () => {
  console.log("connected:", socket.id);

  socket.emit("chat:join", { reservationId }, (ack) => {
    console.log("join ack:", ack);

    socket.emit(
      "chat:send",
      { reservationId, body: "Hola desde test (WS)" },
      (ack2) => {
        console.log("send ack:", ack2);
        setTimeout(() => process.exit(0), 500);
      }
    );
  });
});

socket.on("chat:message:new", (msg) => console.log("new msg:", msg));

socket.on("connect_error", (e) => {
  console.log("connect_error:", e.message);
});
