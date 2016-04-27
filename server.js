// Require the packages we will use:
var http = require("http"),
	socketio = require("socket.io"),
	fs = require("fs"),
	MongoClient = require('mongodb').MongoClient,
	assert = require('assert'),
	mongoose = require('mongoose'),
	User = require('./user-model');

var rooms = new Set();
var users = new Set();
var creator = {};
var creator_user = {};
var pwds = {};
var banned_ids = {};
var banned_users = {};

var id_count = 1;
var count = 1;

var socket_map = {};

var landing = 'the_lobby';
rooms.add(landing);

var hangman_words = ['thanksgiving', 'christmas', 'hanukkah', 'united states of america', 'rapid prototype development', 'hello world', 'socketio', 'nodejs'];

var hangman = {};
var hangman_puzzle = {};
var hangman_current = {};
var hangman_letters = {};
var hangman_guesses = {};

var hangman_max = 10;

var pacman_room = {};
var pacman_step = {};
var pacman_intervals = {};
var pacman_board = {};
var pacman_start_x = {};
var pacman_start_y = {};
var pacman_ghost_x = {};
var pacman_ghost_y = {};
var pacman_pebble = {};
var pacman_dots = {};

var pacman_steps = 6;
var pacman_interval = 250;
var pacman_pebble_steps = 20;

// Listen for HTTP connections.  This is essentially a miniature static file server that only serves our one file, client.html:
var app = http.createServer(function(req, resp){
	// This callback runs when a new connection is made to our HTTP server.
 
	fs.readFile("client.html", function(err, data){
		// This callback runs when the client.html file has been read from the filesystem.
 
		if(err) { 
			return resp.writeHead(500);
		}

		resp.writeHead(200);
		resp.end(data);
	});
});

app.listen(3456);

var url = 'mongodb://localhost:27017/pacman';
mongoose.connect(url, function(err) {
  assert.equal(null, err);
  console.log("Successfully connected to mongodb");
});
 
// Do the Socket.IO magic:
var io = socketio.listen(app);
io.sockets.on("connection", function(socket){
	// This callback runs when a new Socket.IO connection is established.
	msg(socket, 'Welcome to pacman!');
	socket['username'] = '';
	socket['room'] = '';
	socket['color'] = '#000';
	socket['num'] = id_count++;
	socket['wins'] = 0;
	socket['games'] = 0;

	var logged_in = false;

	socket.on('register', function(data) {
		var username2 = filter(data['username']);
		var password2 = data['password'];

		User.findOne({ username: username2 }, function(err, user) {
			if (err) {
				console.log(err + ' find one');
			} else if (!user) {

				if (!setUsername(socket, username2)) {
					io.to(socket.id).emit('bad_login', 'User is already logged in!');	
					return;
				}

				var newUser = new User({
					username: username2,
					password: password2,
					games: 0,
					wins: 0
				});

				newUser.save(function(err) { console.log('new user woo'); });
				logged_in = true;
				socket['wins'] = 0;
				socket['games'] = 0;
				io.to(socket.id).emit('logged_in', []);
			} else {
				user.comparePassword(password2, function(err, isMatch) {
					if (err) {
						console.log(err + ' comp pass');
					} else if (isMatch) {
						if (!setUsername(socket, username2)) {
							io.to(socket.id).emit('bad_login', 'User is already logged in!');
							return;
						}
						logged_in = true;
						socket['wins'] = user['wins'];
						socket['games'] = user['games'];
						io.to(socket.id).emit('logged_in', []);
					} else {
						io.to(socket.id).emit('bad_login', 'Wrong password!');
					}
				});
			}
		});

	});

	socket.on('set_username', function(data) {
		if (!logged_in) {
			return;
		}
		data = filter(data);
		setUsername(socket, data);
	});

	socket.on('create_room', function(data) {
		if (!logged_in) {
			return;
		}
		room = filter(data['room']);
		pwd = data['password'];

		createRoom(socket, room, pwd);
	});

	socket.on('join_room', function(data) {
		if (!logged_in) {
			return;
		}	
		room = filter(data['room']);
		pwd = data['password'];

		joinRoom(socket, room, pwd);
	});
 
	socket.on('new_message', function(data) {
		if (!logged_in) {
			return;
		}
		data = msgFilter(data);
		sendMessage(socket, data);
	});

	socket.on('get_users', function(data) {
		if (!logged_in) {
			return;
		}
		io.to(socket.id).emit('user_list', getClients(data));
	});

	socket.on('ban', function(data) {
		if (!logged_in) {
			return;
		}
		ban(socket, data);
	});

	socket.on('kick', function(data) {
		if (!logged_in) {
			return;
		}
		kick(socket, data);
	});

	socket.on('dir', function(data) {
		if (!logged_in) {
			return;
		}
		setDirection(socket, data);
	});

	socket.on('pacman_start', function(data){
		if (!logged_in) {
			return;
		}	
		if (socket['room'] === landing) {
			msg(socket, 'You must create a room first!');
		}
		pacmanInit(socket['room'], socket);
	});

	socket.on('disconnect', function() {
		if (!logged_in) {
			return;
		}
		User.findOne({ username: socket['username'] }, function(err, user) {
			if (!err) {
				user['wins'] = socket['wins'];
				user['games'] = socket['games'];
			}
		});

		msgRoom(socket['room'], socket['username'] + ' has disconnected');
		users.delete(socket['username']);
		socket.leave(socket['room']);
		updateUsers(socket['room']);
		updateRooms();
	});
});

// send message to everyone in a room
function msgRoom(room, msg) {
	io.to(room).emit('log', '<span class="from-room">[' + room + ']</span><span class="msg-room"> ' + msg + '</span>');
}

// not used
function getNumUsers() {
	return users.prototype.size;
}

// send message
function msg(socket, msg) {
	io.to(socket.id).emit('log', '<span class="from-server">[Server]</span><span class="msg-server"> ' + msg + '</span>');
}

// escape characters
function filter(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;")
         .replace(/ /g, '_');
 }

// filter messages
 function msgFilter(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

// set username
function setUsername(socket, username) {
	if (!username || username === '') {
		msg(socket, 'Username cannot be empty!');
	} else if (username.length > 16) {
		msg(socket, 'Username must be less than 16 characters.');
	} else if (users.has(username)) {
		msg(socket, 'Username is taken! Try a different one.')
	} else if (banned_users[socket['room']] && banned_users[socket['room']].has(username)) {
		msg(socket, 'This username is banned.');
	} else {
		users.delete(socket['username']);
		socket_map[socket['username']] = null;

		if (!socket['username']) {
			socket['username'] = username;
			socket['color'] = color(username);
			joinRoom(socket, landing);
			roomData(socket);
		} else {
			msgRoom(socket['room'], socket['username'] + ' changed username to ' + username + '!');
			socket['username'] = username;
			socket['color'] = color(username);
			updateUsers(socket['room']);
			updateRooms();
		}
		users.add(username);
		socket_map[username] = socket;
		pacmanInitPlayer(socket);			

		return true;
	}	

	return false;
}

// send a message (also parses commands)
function sendMessage(socket, data) {
	if (!data || data === '') {
		return;
	} else if (data.length > 500) {
		msg(socket, 'Message must be less than 500 characters.')
		return;
	}

	// parse command
	if (data.startsWith('!')) {
		var tokens = data.split(' ');
		if (tokens[0] === '!help') {
			msg(socket, '!help - this thing');
			msg(socket, '!user username - change your username');
			msg(socket, '!room room_name [password] - create a room with an optional password');
			msg(socket, '!join room_name [password] - join a room');
			msg(socket, '!kick user - kick a user');
			msg(socket, '!ban user - ban a user');
			msg(socket, '!msg user message - private message a user');
			msg(socket, '!hangman - starts a game of hangman or displays the current state of the hangman game');
			msg(socket, '!guess letter - guesses a letter for hangman');
			msg(socket, '!letters - shows the letters that have been guessed');
		} else if (tokens[0] === '!user' && tokens.length >= 2) {
			setUsername(socket, filter(tokens[1]));
		} else if (tokens[0] === '!room' && tokens.length >= 2) {
			if (tokens.length >= 3) {
				createRoom(socket, tokens[1], tokens[2]);
			} else {
				createRoom(socket, tokens[1]);
			}
		} else if (tokens[0] === '!join' && tokens.length >= 2) {
			if (tokens.length >= 3) {
				joinRoom(socket, filter(tokens[1]), tokens[2]);
			} else {
				joinRoom(socket, filter(tokens[1]));
			}
		} else if (tokens[0] === '!kick' && tokens.length >= 2) {
			kick(socket, tokens[1]);
		} else if (tokens[0] === '!ban' && tokens.length >= 2) {
			ban(socket, tokens[1]);
		} else if (tokens[0] === '!msg' && tokens.length >= 3) {
			var str = '';
			for(var i=2; i<tokens.length; ++i) {
				str += tokens[i] + ' ';
			}
			privateMessage(socket, str, tokens[1]);
		} else if(tokens[0] === '!hangman') {
			if (hangman[socket['room']]) {
				msg(socket, 'A game of hangman has already been started!');

				msg(socket, 'Hangman letters: ' + hangman_current[socket['room']]);
				msg(socket, 'Hangman guesses: ' + hangman_letters[socket['room']]);
				msg(socket, 'Guesses left: ' + hangman_guesses[socket['room']]);
			} else {
				hangman[socket['room']] = true;

				var puzzle = hangman_words[Math.floor(Math.random() * hangman_words.length)];
				hangman_puzzle[socket['room']] = puzzle;
				hangman_current[socket['room']] = puzzle.replace(/[a-z]/g, '*');
				hangman_letters[socket['room']] = '';
				hangman_guesses[socket['room']] = hangman_max;

				msgRoom(socket['room'], socket['username'] + ' started a game of hangman!');
				msgRoom(socket['room'], 'Hangman letters: ' + hangman_current[socket['room']]);
				msgRoom(socket['room'], 'Hangman guesses: ' + hangman_letters[socket['room']]);
				msgRoom(socket['room'], 'Guesses left: ' + hangman_guesses[socket['room']]);

			}
		} else if(tokens[0] === '!guess' && tokens.length >= 2) {
			if (!hangman[socket['room']]) {
				msg(socket, 'Use !hangman to start a game of hangman!');
				return;
			}

			var guess = tokens[1];
			guess = guess.toLowerCase();
			if (guess.length !== 1 || !guess.match(/[a-z]/i)) {
				msg(socket, 'You can only guess letters!');
			} else if (hangman_letters[socket['room']].indexOf(guess) > -1){
				msg(socket, guess + ' has already been guessed!');
			} else {
				if (hangman_puzzle[socket['room']].indexOf(guess) > -1) {
					// good
					var new_str = '';
					for(var i=0; i<hangman_puzzle[socket['room']].length; ++i) {
						if (hangman_puzzle[socket['room']].substring(i, i+1) === guess) {
							new_str += guess;
						} else {
							new_str += hangman_current[socket['room']].substring(i, i+1);
						}
					}
					hangman_current[socket['room']] = new_str;
					hangman_letters[socket['room']] += guess;

					msgRoom(socket['room'], socket['username'] + ' guessed ' + guess + ' correctly!');
					msgRoom(socket['room'], 'Hangman letters: ' + hangman_current[socket['room']]);
					msgRoom(socket['room'], 'Hangman guesses: ' + hangman_letters[socket['room']]);

					if (hangman_current[socket['room']].indexOf('*') < 0) {
						msgRoom(socket['room'], 'Congratulations, you\'ve beaten hangman!');
						hangman[socket['room']] = false;
					} else {
						msgRoom(socket['room'], 'Guesses left: ' + hangman_guesses[socket['room']]);
					}
				} else {
					hangman_letters[socket['room']] += guess;
					hangman_guesses[socket['room']]--;

					msgRoom(socket['room'], socket['username'] + ' guessed ' + guess + ' incorrectly!');
					msgRoom(socket['room'], 'Hangman letters: ' + hangman_current[socket['room']]);
					msgRoom(socket['room'], 'Hangman guesses: ' + hangman_letters[socket['room']]);
					

					if (hangman_guesses[socket['room']] <= 0) {
						msgRoom(socket['room'], 'Out of guesses, the answer was ' + hangman_puzzle[socket['room']] + '.');
						hangman[socket['room']] = false;
					} else {
						msgRoom(socket['room'], 'Guesses left: ' + hangman_guesses[socket['room']]);
					}
				}

			}
		} else if(tokens[0] === '!letters') {
			if (!hangman[socket['room']]) {
				msg(socket, 'Use !hangman to start a game of hangman!');
				return;
			} else {
				msg(socket, 'Hangman letters: ' + hangman_current[socket['room']]);
				msg(socket, 'Hangman guesses: ' + hangman_letters[socket['room']]);
			}
		} else if(tokens[0] === '!pacman') {
			pacmanInit(socket['room'], socket);
		} else {
			msg(socket, 'Unrecognized command, use !help if you need help.')
		}
		return;
	}


	io.to(socket['room']).emit('new_message', {user: socket['username'], message: data, color: socket['color']});
}

// pm someone else
function privateMessage(socket, data, user) {
	if (!socket_map[user]) {
		msg(socket, 'Cannot find user ' + user);
		return;
	}

	var room = socket['room'];
	var other = socket_map[user];

	if (socket.id === other.id) {
		msg(socket, 'That\'s you.');
		return;
	}

	if (room !== other['room']) {
		msg(socket, other['username'] + ' is not in the same room.');
		return;
	}

	io.to(socket.id).emit('new_message', {user: 'to ' + other['username'] + ' <i title="private" class="fa fa-user-secret"></i>', message:data, color:socket['color']})
	io.to(other.id).emit('new_message', {user: socket['username'] + ' <i title="private" class="fa fa-user-secret"></i>', message:data, color: socket['color']})
}

// create a room
function createRoom(socket, room, pwd) {
	if (room && room.length > 16) {
		msg(socket, 'Room name must have less than 16 characters.');
		return;
	}

	if (room.toLowerCase() === "server" || room === landing || rooms.has(room)) {
		msg(socket, room + ' already exists. Please choose a different room name.');
		return;
	}

	if (pwd) {
		pwds[room] = pwd;
	}
	creator[room] = socket.id;
	creator_user[room] = socket['username'];
	banned_ids[room] = new Set();
	banned_users[room] = new Set();

	rooms.add(room);

	joinRoom(socket, room, pwd);

	updateRooms();

	io.to(socket.id).emit('pacman_destroy', []);
}

// join a room
function joinRoom(socket, room, pwd) {
	if (pwds[room] && pwd !== pwds[room]) {
		msg(socket, 'Wrong password!');
		return;
	}

	if (!rooms.has(room)) {
		msg(socket, room + ' does not exist!');
		return;
	}

	if (banned_ids[room] && banned_ids[room].has(socket.id) || banned_users[room] && banned_users[room].has(socket['username'])) {
		msg(socket, 'You are banned from entering ' + room);
		return;
	}

	if (socket['room']) {
		msgRoom(socket['room'], socket['username'] + ' has left ' + socket['room']);
		socket.leave(socket['room']);
		updateUsers(socket['room']);
	}

	socket['room'] = room;
	socket.join(room);

	roomData(socket);

	msgRoom(room, socket['username'] + ' has joined ' + socket['room'] + '! Say hello :)');
	updateUsers(room);

	updateRooms();

	if (pacman_room[room]) {
		pacmanJoin(socket);
	} else {
		io.to(socket.id).emit('pacman_destroy', []);
	}
}

// update the list of rooms for all users
function updateRooms() {
	io.sockets.emit('room_list', getRooms());
}

// get the list of active public rooms
function getRooms() {
	var public_rooms = [];
	for(var r of rooms) {
		if (!pwds[r] || pwds[r] === '') {
			public_rooms.push(r);
		}
	}

	public_rooms.sort(function(a, b) {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	});

	return public_rooms;
}

// ban someone
function ban(socket, user) {
	if (!socket_map[user]) {
		msg(socket, 'Cannot find user ' + user);
		return;
	}

	var room = socket['room'];
	var banned = socket_map[user];

	if (creator[room] !== socket.id) {
		msg(socket, 'Only the room creator can ban users!');
		return;
	}

	if (room !== banned['room']) {
		msg(socket, banned['username'] + ' is not in the room.');
		return;
	}

	banned_ids[room].add(banned.id);
	banned_users[room].add(banned['username']);

	joinRoom(banned, landing);
}

// temporarily kick some fool
function kick(socket, user) {
	if (!socket_map[user]) {
		msg(socket, 'Cannot find user ' + user);
		return;
	}

	var room = socket['room'];
	var kicked = socket_map[user];

	if (creator[room] !== socket.id) {
		msg(socket, 'Only the room creator can kick users!');
		return;
	}

	if (room !== kicked['room']) {
		msg(socket, kicked['username'] + ' is not in the room.');
		return;
	}

	joinRoom(kicked, landing);
}

// update list of users in a particular room
function updateUsers(room) {
	var clients = getClients(room);
	if (clients.length > 0) {
		io.to(room).emit('user_list', clients);
	}
}

// get all clients in a room
function getClients(room) {
	if (!io.sockets.adapter.rooms[room] || !io.sockets.adapter.rooms[room].sockets || !io.sockets.adapter.rooms[room].length === 0) {
		cleanRoom(room);
		return [];
	}

	var users = [];
	for (var id in io.sockets.adapter.rooms[room].sockets) {		
		users.push({'user': io.sockets.connected[id]['username'], 'color': io.sockets.connected[id]['color'], 'wins': io.sockets.connected[id]['wins'], 'games': io.sockets.connected[id]['games']});
	}

	users.sort(function(a, b) {
		if (a < b) return -1;
		if (a > b) return 1;
		return 0;
	});

	return users;
}

// get all sockets in a room
function getSockets(room) {
	if (!io.sockets.adapter.rooms[room] || !io.sockets.adapter.rooms[room].sockets || !io.sockets.adapter.rooms[room].length === 0) {
		return [];
	}

	var users = [];
	for (var id in io.sockets.adapter.rooms[room].sockets) {		
		users.push(io.sockets.connected[id]);
	}

	return users;	
}

// clean up a room after everyone has left
function cleanRoom(room) {
	if (room !== landing) {
		rooms.delete(room);
		if (banned_users[room]) {
			banned_users[room].clear();
		}
		if (banned_ids[room]) {
			banned_ids[room].clear();
		}
		creator[room] = '';
		creator_user[room] = '';
		pwds[room] = '';

		hangman[room] = false;

		clearInterval(pacman_intervals[room]);
	}
}

// send room data to a client
function roomData(socket) {
	io.to(socket.id).emit('room_data', {'room': socket['room'], 'username': socket['username'], 'creator': creator_user[socket['room']]});
}


///////////////////// checkpoint /////////////////////

function pacmanInit(room, socket) {
	if (pacman_room[room]) {
		return;
	}

	pacman_intervals[room] = setInterval(function(){ pacmanStep(room); }, pacman_interval);
	pacman_room[room] = true;

	pacman_board[room] = [	[1, 1, 1, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 2, 1, 1, 1],
							[1, 3, 2, 2, 2, 2, 2, 4, 0, 0, 0, 0, 4, 2, 2, 2, 2, 2, 3, 1],
							[1, 2, 1, 2, 1, 1, 1, 4, 0, 0, 0, 0, 4, 1, 1, 1, 2, 1, 2, 1],
							[2, 2, 2, 2, 1, 2, 2, 4, 4, 4, 4, 4, 4, 2, 2, 1, 2, 2, 2, 2],
							[1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1],
							[1, 2, 2, 2, 2, 2, 2, 3, 1, 0, 0, 1, 3, 2, 2, 2, 2, 2, 2, 1],
							[1, 2, 1, 1, 1, 1, 2, 1, 1, 0, 0, 1, 1, 2, 1, 1, 1, 1, 2, 1],
							[1, 2, 1, 2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 1, 2, 1],
							[1, 2, 1, 2, 1, 1, 0, 5, 5, 5, 5, 5, 5, 0, 1, 1, 2, 1, 2, 1],
							[5, 2, 2, 2, 2, 5, 0, 5, 0, 0, 0, 0, 5, 0, 5, 2, 2, 2, 2, 5],
							[5, 2, 2, 2, 2, 5, 0, 5, 0, 0, 0, 0, 5, 0, 5, 2, 2, 2, 2, 5],
							[1, 2, 1, 1, 1, 1, 0, 5, 5, 5, 5, 5, 5, 0, 1, 1, 1, 1, 2, 1],
							[1, 2, 1, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 1, 2, 1],
							[1, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 1],
							[1, 2, 2, 2, 2, 3, 2, 2, 2, 0, 0, 2, 2, 2, 3, 2, 2, 2, 2, 1],
							[1, 2, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 1],
							[2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2],
							[1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1],
							[1, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 1],
							[1, 1, 1, 2, 1, 1, 1, 1, 1, 4, 4, 1, 1, 1, 1, 1, 2, 1, 1, 1]]

	pacman_start_x[room] = 9;
	pacman_start_y[room] = 1;

	pacman_ghost_x[room] = 9;
	pacman_ghost_y[room] = 9;

	pacman_step[room] = 0;

	pacman_dots[room] = 0;
	for(var i=0; i<pacman_board[room].length; ++i) {
		for(var j=0; j<pacman_board[room][i].length; ++j) {
			if (pacman_board[room][i][j] === 2) {
				pacman_dots[room]++;
			}
		}
	}

	var users = getSockets(room);
	users = shuffle(users);
	for(var i=0; i<users.length; ++i) {
		pacmanInitPlayer(users[i]);
		users[i]['lives'] = 3;
		if (i % 3 === 2) {
			users[i]['ghost'] = true;
		} else {
			users[i]['ghost'] = false;
		}
	}

	io.to(room).emit('pacman_board_init', pacman_board[room]);

	msgRoom(room, socket['username'] + ' has started a game of Pacman!');
}

function pacmanInitPlayer(socket) {
	socket['prev_dir'] = 'none';
	socket['dir'] = 'none';
	socket['next_dir'] = 'none';
	socket['x'] = -1;
	socket['y'] = -1;
	socket['score'] = 0;
	socket['ghost'] = false;
	socket['lives'] = 0;
}

function pacmanJoin(socket) {
	io.to(socket.id).emit('pacman_board_init', pacman_board[socket['room']]);

	pacmanInitPlayer(socket);

	socket['lives'] = 3;
	if (Math.random() < 0.4) {
		socket['ghost'] = true;
	} else {
		socket['ghost'] = false;
	}
}

function pacmanStep(room) {
	if (!pacman_room[room]) {
		return;
	}

	var users = getSockets(room);

	if (pacman_pebble[room] > 0) {
		pacman_pebble[room] -= pacman_interval;
		if (pacman_pebble[room] <= 0) {
			pacmanEmitPebble(room);
		}
	}
	
	for(var i=0; i<users.length; ++i) {
		var socket = users[i];

		if (socket['next_dir'] !== socket['dir']) {
			socket['prev_dir'] = socket['dir'];
			socket['dir'] = socket['next_dir'];
		}

		var x = socket['x']; var y = socket['y']; var board = pacman_board[room];

		if (x === -1 && y === -1) {
			if (socket['lives'] <= 0) {
				socket['dir'] = 'none';
				continue;
			}
			if (socket['ghost']) {
				socket['x'] = pacman_ghost_x[room];
				socket['y'] = pacman_ghost_y[room];
				socket['prev_dir'] = 'none';
				socket['dir'] = 'none';
				socket['next_dir'] = 'none';
			} else {
				socket['x'] = pacman_start_x[room];
				socket['y'] = pacman_start_y[room];
				socket['prev_dir'] = 'none';
				socket['dir'] = 'none';
				socket['next_dir'] = 'none';
			}
		} 

		if (!pacmanMove(socket, socket['dir'])) {
			pacmanMove(socket, socket['prev_dir']);
		} else {
			socket['prev_dir'] = socket['dir'];
		}

		x = socket['x']; y = socket['y'];

		if (board[y][x] === 2 && !socket['ghost']) {
			pacman_board[room][y][x] = 0;
			socket['score']++;
			pacman_dots[room]--;
			pacmanEmitBoard(room);
		} else if (board[y][x] === 3 && !socket['ghost']) {
			pacman_board[room][y][x] = 0;
			socket['score']++;
			pacman_pebble[room] = pacman_interval * pacman_pebble_steps;
			pacmanEmitPebble(room);
			pacmanEmitBoard(room);
		}
	}

	for (var i=0; i<users.length; ++i) {
		for (var j=i+1; j<users.length; ++j) {
			var one = users[i];
			var two = users[j];

			if (one['x'] === two['x'] && one['y'] === two['y'] && one['ghost'] !== two['ghost']) {
				if (one['ghost'] === (pacman_pebble[room] > 0)) {
					one['lives']--;
					one['x'] = -1;
					one['y'] = -1;
					two['score'] += 10;
				} else if (two['ghost'] === (pacman_pebble[room] > 0)) {
					two['lives']--;
					two['x'] = -1;
					two['y'] = -1;
					one['score'] += 10;
				}
			}
		}
	}

	if (pacmanCheckWin(room)) {
		msgRoom(room, 'Game over!');
	}

	pacmanEmitPlayers(room);
	pacmanEmitUpdate(room);
}

function pacmanMove(socket, dir) {
	var x = socket['x']; var y = socket['y']; var board = pacman_board[socket['room']];
	switch(dir) {
		case 'left':
			if (x === 0) {
				socket['x'] = board[y].length-1;
				return true;
			} else if (x > 0 && board[y][x-1] !== 1 && !(socket['ghost'] && board[y][x-1] === 4 || !socket['ghost'] && board[y][x-1] === 5)) {
				socket['x']--;
				return true;
			}
			break;
		case 'up':
			if (y === 0) {
				socket['y'] = board.length-1;
				return true;
			} else if (y > 0 && board[y-1][x] !== 1 && !(socket['ghost'] && board[y-1][x] === 4 || !socket['ghost'] && board[y-1][x] === 5)) {
				socket['y']--;
				return true;
			}
			break;
		case 'right':
			if (x === board[y].length-1) {
				socket['x'] = 0;
				return true;
			} else if (x < board[y].length-1 && board[y][x+1] !== 1 && !(socket['ghost'] && board[y][x+1] === 4 || !socket['ghost'] && board[y][x+1] === 5)) {
				socket['x']++;
				return true;
			}
			break;
		case 'down':
			if (y === board.length-1) {
				socket['y'] = 0;
				return true;
			} else if (y < board.length-1 && board[y+1][x] !== 1 && !(socket['ghost'] && board[y+1][x] === 4 || !socket['ghost'] && board[y+1][x] === 5)) {
				socket['y']++;
				return true;
			}
			break;
	}
	return false;
}

function pacmanEmitUpdate(room) {
	io.to(room).emit('pacman_update', []);
}

function pacmanEmitPebble(room) {
	io.to(room).emit('pacman_pebble', pacman_pebble[room] > 0);
}

function pacmanEmitBoard(room) {
	io.to(room).emit('pacman_board', pacman_board[room]);
}

function pacmanEmitPlayers(room) {

	var users = getSockets(room);
	var players = {};

	for (var i=0; i<users.length; ++i) {
		var socket = users[i];
		var user = socket['username'];
		var x = socket['x'];
		var y = socket['y'];
		var dir = socket['dir'];
		var score = socket['score'];
		var ghost = socket['ghost'];
		var lives = socket['lives'];
		var color = socket['color'];
		var num = socket['num'];

		players[user] = {'x': x, 'y': y, 'dir': dir, 'score': score, 'ghost': ghost, 'lives': lives, 'color': color, 'num': num};
	}

	io.to(room).emit('pacman_players', players);
}

function pacmanCheckWin(room) {

	if (pacman_dots[room] <= 0) {
		pacmanEmitPlayers(room);
		io.to(room).emit('pacman_win', 'Pacmen');

		pacman_room[room] = false;
		clearInterval(pacman_intervals[room]);

		var users = getSockets(room);
		for (var i=0; i<users.length; ++i) {
			var socket = users[i];
			socket['games']++;
			if (!socket['ghost']) {
				socket['wins']++;
			}
		}

		return true;
	} 

	var users = getSockets(room);
	var pacLives = 0;
	var ghostLives = 0;
	var pacs = 0;
	var ghosts = 0;
	for (var i=0; i<users.length; ++i) {
		var socket = users[i];
		if (socket['ghost']) {
			ghostLives += socket['lives'];
			ghosts++;
		} else {
			pacLives += socket['lives'];
			pacs++;
		}
	}

	if (pacs > 0 && pacLives === 0) {
		pacmanEmitPlayers(room);
		io.to(room).emit('pacman_win', 'Ghosts');

		pacman_room[room] = false;
		clearInterval(pacman_intervals[room]);

                var users = getSockets(room);
                for (var i=0; i<users.length; ++i) {
                        var socket = users[i];
                        socket['games']++;
                        if (socket['ghost']) {
                                socket['wins']++;
                        }
                }

		return true;		
	}

	if (ghosts > 0 && ghostLives === 0) {
		pacmanEmitPlayers(room);
		io.to(room).emit('pacman_win', 'Pacmen');

		pacman_room[room] = false;
		clearInterval(pacman_intervals[room]);

                var users = getSockets(room);
                for (var i=0; i<users.length; ++i) {
                        var socket = users[i];
                        socket['games']++;
                        if (!socket['ghost']) {
                                socket['wins']++;
                        }
                }


		return true;		
	}

	return false;
}
/*
function pacmanEmitIntermediate(room) {

	var users = getSockets(room);
	var players = {};

	var step = pacman_step[room];
	var board = pacman_board[room];

	for (var i=0; i<users.length; ++i) {
		var socket = users[i];
		var user = socket['username'];
		var x = socket['x'];
		var y = socket['y'];
		var dir = socket['dir'];
		var score = socket['score'];

		if (dir === 'left') {
			x -= (x > 0 && board[y][x-1] !== 1) ? step / pacman_steps : 0;
		}
		if (dir === 'right') {
			x += (x < board[y].length-1 && board[y][x+1] !== 1) ? step / pacman_steps : 0;
		}
		if (dir === 'up') {
			y -= (y > 0 && board[y-1][x] !== 1) ? step / pacman_steps : 0;
		}
		if (dir === 'down') {
			y += (y < board.length-1 && board[y+1][x] !== 1)  ? step / pacman_steps : 0;	
		}

		players[user] = {'x': x, 'y': y, 'dir': dir, 'score': score};
	}

	io.to(room).emit('pacman_players', players);
}
*/

function setDirection(socket, data) {
	socket['next_dir'] = data;
}

function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

// used to color code usernames
 function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
       hash = str.charCodeAt(i) + ((hash << 7) - 7*hash);
    }
    return hash;
 } 

 // used to colorcode usernames
 function color(str) {
    var i = hashCode(str);
    var c = (i & 0x00FFFFFF)
       .toString(16)
       .toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
 }
