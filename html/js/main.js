window.onload = function() {
var connectServerWS = document.getElementById('ConnectServerWSButton');
var hangupButton = document.getElementById('hangupButton');
var callButton = document.getElementById('callButton');
var serverWSAddr = document.getElementById('ServerAddr');  
var socket;
var trickleEnabled = false;
var useStunServers = false;
    
var mytoken = window.mytoken = '';
function log(entry){
    console.log(new Date().toLocaleString()+'   '+entry+'\n');
};
 
callButton.onclick = function(){
    callButton.disabled = true;
    hangupButton.disabled = false;
    StartMedia();
}   
hangupButton.onclick = function(){
    log('C->S: {"type":"hangup"}');
    socket.send( JSON.stringify({type: "hangup" , token: mytoken}));   
    mytoken = '';
}
connectServerWS.onclick = function(){
    console.log('connectWS onClick');
    
    connectServerWS.disabled = true;
    serverWSAddr.disabled = true;
    
    
    log('Establishing connection to '+serverWSAddr.value);
    
    socket = new WebSocket(serverWSAddr.value);
    socket.onopen = function(){
        log('WebSocket Opened Successful');
        log('C->S: Sending registerRtcEndpoint');
        socket.send( JSON.stringify({type: "registerRtcEndpoint" , token: mytoken}));
    };
    socket.onerror = function(event){
        log('Error connecting WebSocket');
    };
    socket.onclose = function(event){
        var reason;
         // See http://tools.ietf.org/html/rfc6455#section-7.4.1
        if (event.code == 1000)
            reason = "Normal closure, meaning that the purpose for which the connection was established has been fulfilled.";
        else if(event.code == 1001)
            reason = "An endpoint is \"going away\", such as a server going down or a browser having navigated away from a page.";
        else if(event.code == 1002)
            reason = "An endpoint is terminating the connection due to a protocol error";
        else if(event.code == 1003)
            reason = "An endpoint is terminating the connection because it has received a type of data it cannot accept (e.g., an endpoint that understands only text data MAY send this if it receives a binary message).";
        else if(event.code == 1004)
            reason = "Reserved. The specific meaning might be defined in the future.";
        else if(event.code == 1005)
            reason = "No status code was actually present.";
        else if(event.code == 1006)
           reason = "The connection was closed abnormally, e.g., without sending or receiving a Close control frame";
        else if(event.code == 1007)
            reason = "An endpoint is terminating the connection because it has received data within a message that was not consistent with the type of the message (e.g., non-UTF-8 [http://tools.ietf.org/html/rfc3629] data within a text message).";
        else if(event.code == 1008)
            reason = "An endpoint is terminating the connection because it has received a message that \"violates its policy\". This reason is given either if there is no other sutible reason, or if there is a need to hide specific details about the policy.";
        else if(event.code == 1009)
           reason = "An endpoint is terminating the connection because it has received a message that is too big for it to process.";
        else if(event.code == 1010) 
            reason = "An endpoint (client) is terminating the connection because it has expected the server to negotiate one or more extension, but the server didn't return them in the response message of the WebSocket handshake. <br /> Specifically, the extensions that are needed are: " + event.reason;
        else if(event.code == 1011)
            reason = "A server is terminating the connection because it encountered an unexpected condition that prevented it from fulfilling the request.";
        else if(event.code == 1015)
            reason = "The connection was closed due to a failure to perform a TLS handshake (e.g., the server certificate can't be verified).";
        else
            reason = "Unknown reason";
        
        log('WebSocket Connection to the server is closed with code '+event.code+': '+reason);
        
        connectServerWS.disabled = false;
        serverWSAddr.disabled = false;
        
    };
    socket.onmessage = function(evt) { onServerMessage(evt); };
    
};
    


function onServerMessage(evt){
    log('S->C: received msg '+evt.data);
    var json = JSON.parse(evt.data);
    
    switch (json.type){
        case 'registerRtcEndpointOK':
            mytoken = json.token
            log('WebClient Registered Successfully!, my token is '+mytoken);
            callButton.disabled = false;          
            break;
		case 'offerSdp':
			console.log('OfferSdp =>', json.offerSdp);
			var desc=new RTCSessionDescription();
            desc.type="offer";
            desc.sdp=json.offerSdp;
			pc = new RTCPeerConnection(peerConnectionServers);
			log('pc: Created local peer connection object as');
			pc.onicecandidate = function(e) {
				onIceCandidate(pc, e);
			};
			pc.oniceconnectionstatechange = function(e) {
				onIceStateChange(pc, e);
			};
			pc.onaddstream = gotRemoteStream;
            pc.setRemoteDescription(desc);
			log('pc: Set RemoteDescrition');
			//incomingCallHandler()
			

			break;
		case 'connected':
		    console.log('connected');
		    log('C->S: {"type":"start"}');
            socket.send( JSON.stringify({type: "start", token : mytoken}));
		break;
        case 'answerSdp':
            console.log('AnswerSdp =>', json.answerSdp);
            var desc=new RTCSessionDescription();
            desc.type="answer";
            desc.sdp=json.answerSdp;
            pc.setRemoteDescription(desc);
            log('pc: Set RemoteDescrition');
            break;
        case 'event':
            if(json.event == 'disconnected')
            {
                log('pc: Closing pc');
                pc.close();
                console.log('PeerConnection closed. peer= ', pc);  
				remoteVideo.pause();
                remoteVideo.srcObject = null;
                remoteVideo.load(); //reload to clear previous image
                callButton.disabled = false;
                hangupButton.disabled = true;
                
            } 	
            break;
         

        }
};

var startTime;
var localVideo = document.getElementById('localVideo');
var remoteVideo = document.getElementById('remoteVideo');


localVideo.addEventListener('loadedmetadata', function() {
  log('Local video videoWidth: ' + this.videoWidth +
    'px,  videoHeight: ' + this.videoHeight + 'px');
});

remoteVideo.addEventListener('loadedmetadata', function() {
  log('Remote video videoWidth: ' + this.videoWidth +
    'px,  videoHeight: ' + this.videoHeight + 'px');
});

remoteVideo.onresize = function() {
  log('Remote video size changed to ' +
    remoteVideo.videoWidth + 'x' + remoteVideo.videoHeight);
  // We'll use the first onsize callback as an indication that video has started
  // playing out.
  if (startTime) {
    var elapsedTime = window.performance.now() - startTime;
    log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
};

var localStream = window.localStream;
var remoteStream = window.remoteStream;
function getName(pc1) {
  return ('pc:');
}

var pc = window.pc;

var offerOptions = 
	 {				
		offerToReceiveAudio: true,
		offerToReceiveVideo: true
     };

if (useStunServers){
    log('Using Peer connection Servers { stun:stun.l.google.com:19302 & stun:stun.services.mozilla.com } ');
    var peerConnectionServers = {'iceServers': [{'urls': 'stun:stun.l.google.com:19302'}, {'urls': 'stun:stun.services.mozilla.com'}]};
} else {
    log('Not using Peer Connection Servers (Setting to null)');
    var peerConnectionServers = null;
}

function handleError(error) {
  if (error.name === 'ConstraintNotSatisfiedError') {
    errorMsg('The resolution ' + constraints.video.width.exact + 'x' +
        constraints.video.width.exact + ' px is not supported by your device.');
  } else if (error.name === 'PermissionDeniedError') {
    errorMsg('Permissions have not been granted to use your camera and ' +
      'microphone, you need to allow the page access to your devices in ' +
      'order for the demo to work.');
  }
  errorMsg('getUserMedia error: ' + error.name, error);
}

function errorMsg(msg, error) {
    console.error(error);
  
}

var constraints = window.constraints =
        {
        audio: true,
        video: {
			width: {
				min: "640",
				max: "1280"
			},
			height: {
				min: "480",
				max: "720"
			}
		}
};
  
function StartMedia(){
         navigator.mediaDevices.getUserMedia(constraints)
            .then(gotStream)
            .catch(handleError);
     
}

function gotStream(stream) {
  log('Received local stream');
  localVideo.srcObject = stream;
  localStream = stream;
  call();
  
}

function call(){
  log('Starting peer call');
  startTime = window.performance.now();
  var videoTracks = localStream.getVideoTracks();
  var audioTracks = localStream.getAudioTracks();
  if (videoTracks.length > 0) {
    log('Using video device: ' + videoTracks[0].label);
  }
  if (audioTracks.length > 0) {
    log('Using audio device: ' + audioTracks[0].label);
  }
  //var servers = null;
  pc = new RTCPeerConnection(peerConnectionServers);
  log('pc: Created local peer connection object as');
  pc.onicecandidate = function(e) {
    onIceCandidate(pc, e);
  };
  pc.oniceconnectionstatechange = function(e) {
    onIceStateChange(pc, e);
  };
  pc.onaddstream = function (e) {
   onAddStream(pc,e);   
  }
  pc.addStream(localStream);
  log('pc: Added local stream ');

  log('pc: createOffer sdp');
  pc.createOffer(
    offerOptions
  ).then(
    onCreateOfferSuccess,
    onCreateSessionDescriptionError
  );
    
}
function onAddStream(pc,e){	                	  
  console.log('pc: onaddstream, adding remote stream');
    remoteVideo.srcObject= e.stream;
    remoteVideo.play();
    //stream is connected, sending start
    log('C->S: {"type":"start"}');
    socket.send( JSON.stringify({type: "start", token: mytoken}));
    hangupButton.disabled = false;
  
}
function onSetSessionDescriptionError(error) {
  trace('Failed to set session description: ' + error.toString());
}


function onCreateOfferSuccess(desc) {
  log('pc: Offer Created successfully\n' + desc.sdp);
   if(trickleEnabled){
    log('trickleMode is enabled, sending sdp now, will trickle ICE candidates as they come');
    log('C->S: {"type": "rtcOfferSdp", "offerSdp": "'+desc.sdp+'"} ');
    socket.send( JSON.stringify({type: "rtcOfferSdp", offerSdp: desc.sdp, token:mytoken}));
    }
  
  log('pc: setLocalDescription start');
  pc.setLocalDescription(desc).then(
    function() {
      onSetLocalSuccess(pc);
    },
    onSetSessionDescriptionError
  );
}

function onCreateAnswerSuccess(desc) {
  trace('Answer from pc:\n' + desc.sdp);
  trace('pc setLocalDescription start');
     log('C->S: {"type": "rtcAnswerSdp", "answerSdp": "'+desc.sdp+'"} ');
    socket.send( JSON.stringify({type: "rtcAnswerSdp", answerSdp: desc.sdp}));
    pc.setLocalDescription(desc).then(
    function() {
      onSetLocalSuccess(pc);
    },
    onSetSessionDescriptionError
  );
}

function onCreateSessionDescriptionError(error) {
  log('Failed to create session description: ' + error.toString());
}

function onSetLocalSuccess(pc) {
  log(getName(pc) + ' setLocalDescription complete');
  //log('C->S: {type: "rtcAnswerSdp", answerSdp: '+sdp+'} ');
  //socket.send( JSON.stringify({type: "rtcAnswerSdp", answerSdp: sdp}))
  
}

function onIceCandidate(pc, event) {
  var candidate = event.candidate;
  if(candidate) 
   { 
     log(getName(pc) + ' ICE candidate: \n' + event.candidate.candidate);
     if(trickleEnabled){
        log('C->S: ' + JSON.stringify({type: "rtcCandidate", candidate:candidate})); 
        socket.send(JSON.stringify({type: "rtcCandidate", candidate:candidate, token: mytoken}));
     }
       
   }
   else
 	{
        log(getName(pc) + ' endRtcCandidate');
        if(trickleEnabled){
            log('C->S: '+JSON.stringify({type: "endRtcCandidate"})); 
     	    socket.send(JSON.stringify({type: "endRtcCandidate", token: mytoken}));
        } else {
            log('Candidates all gathered, sending SDP');
            var sdp = pc.localDescription.sdp;
            log('C->S: {type: "rtcOfferSdp", offerSdp: '+sdp+'} ');
            socket.send( JSON.stringify({type: "rtcOfferSdp", offerSdp: sdp, token: mytoken}))

        }
  
 	}  
    
}
function gotRemoteStream(e) {
  remoteVideo.srcObject = e.stream;
  trace('pc received remote stream');
}

function onIceStateChange(pc, event) {
  if (pc) {
    log(getName(pc) + ' ICE state: ' + pc.iceConnectionState);
    console.log('ICE state change event: ', event);
  }
}
}
















