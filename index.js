var cp = require('child_process'), EventEmitter = require('events').EventEmitter,
inherits = require('util').inherits, es = require('event-stream'), through = require('through');

inherits(MpgPlayer, EventEmitter);
exports.MpgPlayer = MpgPlayer;

exports.getDevices = function(callback) {
  try {
    return cp.execSync('cat /proc/asound/pcm')
      .toString()
      .split('\n')
      .reduce((acc, line) => {
        const [rawAddress, name] = line.split(': ');
        const addr =
          rawAddress &&
          rawAddress
            .split('-')
            .map(i => parseInt(i))
            .join(',');
        return addr ? [...acc, { address: `hw:${addr}`, name: `${name} [${addr}]` }] : acc;
      }, []);
  } catch {
    return [];
  }
}

function MpgPlayer(device, noFrames) {
	var self = this, args = ['-R'];
	if(device && typeof device === 'object') args.push('-a'+device.address);
	
	this.child = cp.spawn('mpg123', args); this.stream = this.child.stdin;
	if(noFrames) this._cmd('SILENCE');
	
	this.child.stdout.pipe(es.split()).pipe(through(function(data) {
		var line = data.split(' '), type = line.shift();
		switch(type) {
		case '@P':
			var event = ['end', 'pause', 'resume'][+line.shift()]; self.emit(event);
			if(event == 'end' && self._s != 1) { self.track = self.file = null; }
		break; case '@E':
			var msg = line.join(' '), err = new Error(msg); err.type = 'mpg-player';
			if(msg.indexOf("No stream opened") != -1) {
				for(var i=0,l=self._gpcb.length; i<l; i++) self._gpcb[i](0,0,0);
				self._gpcb = [];
			}
			self.emit('error', err);
		break; case '@F':
			self.emit('frame', line);
		break; case '@J':
			self.emit('jump');
		break; case '@V':
			var per = line[0]; per = per.substring(0, per.length-1);
			self.emit('volume', per);
		break; case '@S':
			if(self._s == 1) {
				self.mpeg = Number(line[0]);
				self.sampleRate = line[2];
				self.channels = Number(line[4]);
				self.bitrate = Number(line[10]);
				self._s = 2; self._cmd('SAMPLE');
			}
		break; case '@SAMPLE':
			if(self._s == 2) {
				self.samples = line[1];
				self.length = Math.round((self.samples/self.sampleRate)*10)/10;
				self._s = 0; self.emit('format');
			}
			var s = line[0], l = line[1], p = (s/l);
			for(var i=0,l=self._gpcb.length; i<l; i++) self._gpcb[i](p,s,l);
			self._gpcb = [];
		break;
		}
	}));
}

var p = MpgPlayer.prototype;

p._cmd = function() {
	var args = [].slice.call(arguments);
	this.stream.write(args.join(' ') + '\n');
	return this;
}
p.play = function(file) {
	this.track = file.substr(file.lastIndexOf('/')+1);
	this.file = file; this._s = 1; return this._cmd('L', file);
}
p.pause = function() {
	return this._cmd('P');
}
p.quit = function() {
	return this._cmd('Q');
}
p.stop = function() {
	return this._cmd('S');
}
p.pitch = function(pitch) {
	pitch = Math.min(Math.max(pitch, -0.75), 0.1);
	return this._cmd('PITCH', pitch);
}
p.volume = function(vol) {
	vol = Math.min(Math.max(vol, 0), 100);
	return this._cmd('V', vol);
}
p.seek = function(pos) {
	pos = Math.min(Math.max(pos, 0), 1);
	return this._cmd('K', Math.floor(pos*this.samples));
}
p._gpcb = [];
p.getProgress = function(callback) {
	this._gpcb.push(callback);
	return this._cmd('SAMPLE');
}
p.close = function() {
	this.child.kill();
}

if(!module.parent) {
	new MpgPlayer().play(process.argv[2]);
}

function execCmd(cmd, callback) {
	cp.exec(cmd, function (err, out, stderr) {
		if(err) { console.log("Command Exec Erorr: ",err); return; }
		if(stderr) { console.log("Command Erorr: ",stderr); return; }
		if(callback) callback(out);
	});
}
