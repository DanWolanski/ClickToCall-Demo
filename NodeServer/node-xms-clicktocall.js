#!/usr/bin/env node
// Author - Dan Wolanski
// This is a sample, showing how to use the request module to create a 
// Http 'long polling' connection for use with the XMS REST API
// then will peform a simple call flow of "play followed by record"
//
// This script is dependant on the following npm packages
//			request - Simplified HTTP request client.
//			xml2js - Simple XML to JavaScript object converter.
//			yargs - Light-weight option parsing with an argv hash. No optstrings attached.
//			events - Used to signal async operations such as events or function completion
//			keypress - Make process.stdin begin to emitt keypress events
//			winston - A multi-transport async logging library for node.js
//			ws - Simple to use, blazing fast and thoroughly tested WebSocket client and server
//			uid-generator - Generates random tokens with custom size and base-encoding using the RFC 4122 v4 UUID algorithm
//			promise - This is a simple implementation of Promises


var argv = require('yargs')
	.usage('Usage: $0 -h [hostename] -p [port] -a [appid] -l [loglevel]')
	.default('h','127.0.0.1')
	.alias('h','hostname')
	.default('p','81')
	.alias('p','port')
	.default('a','app')
	.alias('a','appid')
	.default('l','info')
	.alias('l','loglevel')
	.default('c','warn')
	.alias('c','consoleloglevel')
	.default('f','node-xms.txt')
	.alias('f','logfile')
	.default('w', '8800')
	.alias('w','wssport')
	.default('s', 'sip:play_demo@127.0.0.1')
	.alias('s','sipaddress')
	.argv;


var logger = require('winston');

logger.level = argv.loglevel;
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {'timestamp':true , 'colorize':true , 'level':argv.consoleloglevel});
logger.add(logger.transports.File, { 'filename': argv.logfile , 'timestamp':true , 'json':false});
logger.info('Setting logfile level to '+argv.loglevel+' and console log level to '+argv.consoleloglevel);

//using this header for all requests
var headers = {"Content-Type":"application/xml" };

var request = require('request'),
 parseString = require('xml2js').parseString,
 events = require('events'),
 keypress = require('keypress');

 var TokenGen = require('uid-generator');
 const tokgen = new TokenGen();
 
//class MyEmitter extends EventEmitter {}
var myEmitter = new events.EventEmitter(); 

var confurl="";
var confid="";
var callers = [];



// This will capture the Ctrl-C
process.on('SIGINT', () => {
	setTimeout(function(){ process.exit() }, 5000);		
   logger.log('warn','Quiting  - Cleaning up');
	callers.forEach(function(href){
		DropCall(href);
	});
});
//Setup the keypress to produce events, this lets you issue q to cleanup
keypress(process.stdin);
process.stdin.on('keypress', function (ch, key) {
	if(key && key.name == 'q'){
	setTimeout(function(){ process.exit() }, 5000);		
	   logger.log('warn','Quiting due to q keypress - Cleaning up');
		callers.forEach(function(href){
			DropCall(href);
		});
		//Wait for 5 seconds for everything to cleanup and then force exit
}
});
 
var SiptoWsHrefMap=[];
///////////////////////////////////////////////////////////////////////////////
//WebSocket Interface
////////////////////////////////////////////////////////////////////////////////

const WebSocket = require('ws');

wss = new WebSocket.Server({
	port: argv.wssport
    
});
function heartbeat(){
	this.isAlive = true;
}
function sendWSMessage(ws,message,logstr,callback){
	logger.verbose('S->C '+logstr+' (Token='+ws.ClientToken+')');
	logger.log('debug','[ '+message+' ]');
	ws.send(message);
	//TODO put in some error checking here
	if(callback){
		callback(null,ws);
	}
}
function handleWSMessage(ws , message){
	var json = JSON.parse(message);
	//Note should check the message token with session token.
	logger.verbose('C->S: '+json.type+' from Token='+ws.ClientToken);
	logger.log('debug','[ '+message+' ]');
	switch(json.type){
		case 'registerRtcEndpoint':
			//Todo put in some token exchange thing there
			const mytoken=tokgen.generateSync();
			ws.ClientToken = mytoken;
			logger.info('Registering new Client, Token='+ws.ClientToken);
			sendWSMessage(ws,JSON.stringify({type : 'registerRtcEndpointOK', token : ws.ClientToken}),'tegisterRtcEndpoint');
			
			break;
		case 'rtcOfferSdp':
			//check token here
			ws.ClientSdp = json.offerSdp;
			CreateWebCallOnXMS(ws,function(err,ws){
				if(!err && ws.XmsSdp){
					sendWSMessage(ws,JSON.stringify({type : 'answerSdp', token : ws.ClientToken, answerSdp : ws.XmsSdp}),'answerSDP');
				}
			  });
			break;
		case 'hangup':
			DropCall(ws.clienthref,function(err,href){
				if(!err){
					sendWSMessage(ws,JSON.stringify({type : 'event',event:'disconnected', token : ws.ClientToken}),'event:hangup');
				}
			
			});
			if(ws.Siphref){
				DropCall(ws.Siphref);
			}
			break;
		case 'start':
			MakeSipCall(argv.sipaddress,function(err,href){
				if(!err){
					logger.log('debug','Associating '+href+' to Token='+ws.ClientToken);
					ws.Siphref=href;
					SiptoWsHrefMap[href]=ws.clienthref;
				}
			});
			break;
		default:
			logger.warn('Unknown event received from WebClient Token='+ws.ClientToken);
			break;
	}
	
}
wss.on('open', function open(){
	logger.info('Watting for websocket connections on port ' + argv.wssport);
});

wss.on('connection', function connection(ws, req){
	ws.isAlive = true;
	ws.on('pong',heartbeat);
	ws.remoteAddress =  req.connection.remoteAddress;
	logger.info('Connection accepted from ' + ws.remoteAddress);
	ws.on('close' , function disconnect(){
		logger.info('Client Connection closed from ' + ws.remoteAddress+' Token='+ws.ClientToken );
		var index=callers.indexOf(ws.clienthref);
			if (index > -1) {
				DropCall(ws.clienthref);
			}
			if(ws.Siphref){
					DropCall(ws.Siphref);
				
			}

	});
	ws.on('message' , function wsmessage(message) {
		logger.log('silly','Got Message [' + message +' ]');
		handleWSMessage(ws , message);
	});
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping('', false, true);
  });
}, 30000);
    
///////////////////////////////////////////////////////////////////////////////
//XMS FUNCTIONS
////////////////////////////////////////////////////////////////////////////////

//Start by creating the event monitor
logger.log('info','******************************');
logger.log('info','* STARTING XMS Event Monitor *');
logger.log('info','******************************');
var data="<web_service version=\"1.0\"> <eventhandler><eventsubscribe action=\"add\" type=\"any\" resource_id=\"any\" resource_type=\"any\"/> </eventhandler></web_service>";

//TODO- Should likely also include a flag for https vs http
var url='http://'+argv.hostname+':'+argv.port+'/default/eventhandlers?appid='+argv.appid;
var options={
	method: 'POST',
	url: url,
	headers:headers,
	body: data
};

logger.log('verbose','S->XMS: POST to '+url+':\n');
logger.log('debug','[ '+data+' ]');
request(options, function (error,response,body){ 
	logger.log('verbose',"XMS->S: "+response.statusCode+" RESPONSE");
	if(!error && response.statusCode == 201){
		logger.log('debug',body);
		parseString(body,function(err,result){
			if(err){
				logger.error(err);
			}
			logger.log('verbose',"%j",result);
			//Here we need to parse the response for the href that will be used to start the long poll
			var href=result.web_service.eventhandler_response[0].$.href;
			logger.log('verbose',"href="+href)  ;
			url='http://'+argv.hostname+':'+argv.port+href+'?appid='+argv.appid;
			logger.log('info',"New url for eventhandler="+url);
			});
		logger.log('debug','S->XMS: Starting event monitor via GET to '+url);
		//Starting the long poll, this will keep the http GET active and deliver each event as a chunked response
		// The callback for 'data' is used to process each event.
		request
			.get(url)
			.on('response',function(res){				
				res.on('data',eventcallback);
				res.on('end',eventendcallback);
			});
			
			myEmitter.emit('EventhandlerStarted');
	} else {
		logger.error("ERROR connecting to XMS!!");
		process.exit();
	}
	});

// Here is the folow for the application
myEmitter.on('Event',processEvent);

//This function will be used as the callback for each event in the long poll
//The format of the event in is first the size followed by the XML event
var tmpbuffer=""; 
//Note this tmpbuffer will be used to save partial events that may be received
function eventcallback(eventbuffer){

	//First check to make sure there is actual data inside the current buffer
	if(eventbuffer.length > 0){
		
		logger.log('silly',"Eventcallback, eventbuffer=["+eventbuffer+"]");
		var eventdata=eventbuffer.toString('ascii' );
		
		//Check to see if there is any data left over from previous processing, 
		// if so prepend it to current event buffer before processing and clear the pending buffer
		if(tmpbuffer.length > 0){
			logger.log('debug',"Appending fragment to start of buffer");
			eventdata=tmpbuffer+eventbuffer.toString('ascii' );
			tmpbuffer="";
		}
		logger.log('debug','Data Received [size=0x'+eventdata+']');
		
		//Checking to see if there are multiple events contained in the data buffer.  Format of the stream will be
		// length of event followed by <web_service> event.  
		// This logic will simple split up the buffer into multiple events by looking for the end tag of the webservice
		// and splitting on it.  The replace is added because the node lookahead/behind doesn't work in all cases
		// and the delimiter is needed to deserialize so the replace is done to insert a delimiter to split on and still
		// have the full xml
		//TODO - Improve logic here used to split events.
		var data=eventdata.replace("</web_service>\n","</web_service>CLIPEVENTHERE");
		var events=data.split(/CLIPEVENTHERE/);
		if(events.length > 1){
			logger.log('debug','Multiple Events found inside the eventdata, eventcount='+events.length);
		}
		// Once split, then process each event
		events.forEach(function(event){
			logger.log('silly','Processing event {{ '+event+' }}');
			//Check to make sure the event has both the opening and closing tags, if not, it may be a partal
			//  buffer.  
			if( event.includes('<web_service') && event.includes('</web_service>') ){
				// Pull the byte count from the first line of the message
				var bytecount=parseInt(event.substr(0,event.indexOf('<web_service')),16);
				// Next pull out the xml partion of the event.
				var xml=event.substring(event.indexOf('<web_service'),event.indexOf('</web_service>')+14);
				// TODO- Should put a check in there to see if the bytecount provided matches actual bytecount of xml
				
				logger.log('debug','------------------------------------------------------------');	
				logger.log('debug',"bytecount="+bytecount+",xml length="+xml.toString('ascii' ).length);
				logger.log('debug',xml);
				//Using the xml2js to convert the xml to json for easy parsing
				parseString(xml,function(err,evt){
					if(err){
						//TODO- Include some more robust error processing/logging
						logger.error(err);
					} else{
						//logger.log(xml);
						//Fire off the xml data to the processor for further processing
						myEmitter.emit('Event',xml);
					}
				}); //TODO we should check that the parseString was succesfful
			}
			else{
				// If the event doesn't have an opening and closing tag, it is likely a partial buffer, saving
				// contents for the next buffer to process
				logger.log('verbose',"Not a fully formed message,saving fragment for next buffer");
				logger.log('debug',"Saving partial buffer ["+event+"]");
				tmpbuffer=event;
			}
			
		});
	}
}

//This is the notification that the EVENT monitor was terminated,
function eventendcallback(){
	logger.log('warn',"XMS->S: EVENT Monitor Terminated by server");
	//TODO ReEstablish the connection or cleanup connections and exit
}

//This is the function that will be triggered on the 'Event' firing
function processEvent(evtxml){
	parseString(evtxml, function (err,evt){
		// Note $ is used in the package for the attributs
		// Incoming call event
		if(evt && evt.web_service){
			var href=evt.web_service.event[0].$.resource_id;
			if(href){
				logger.log('verbose',href +" - "+evt.web_service.event[0].$.type+" event received");
			}
			//Checking to see if there is a hangup, this is put int to prevent 404 messages sent
			// because of state machine progressing on terminated calls.
			//TODO - Put in better use of the json/XML parsing rather then string searching the message
			if(evtxml.match(/<event_data name="reason" value="hangup"/)){
				logger.log('verbose',href+" - Hangup found in the event reason, waiting for hangup message");
				// Just returning the hangup message should be soon.
				return;

			}
			switch(evt.web_service.event[0].$.type){
			case 'incoming':
				//guid is the tag that is used to find the call in logs and traces, printing out here 
				// to allow for matching between href and guid
				var guid="";
				logger.log('verbose',href+" - New Incoming Call detected");
				logger.log('debug',href+" - Incoming Event["+evtxml+"]");
				//First add the call to the caller list 
				callers.push(href);
				//Then answer the call
				AnswerCall(href);
				break;
			// Call was hungup, not that XMS will delete the resources and automaticly remove the caller from the conf 
			//  so really all there is to do is update the local side
			case 'hangup':
				
				//Find the call and remove it from the callers list
				var index=callers.indexOf(href);
				if (index > -1) {
					callers.splice(index,1);
				}
				break;
			//This is generated when the answer has completed when async_completion is enabled
			case 'accepted':
				break;
			//Indicates that the call messaging has completed and call is "answered"
			case 'answered':
				
				break;
			//This event is when the ICE has completed and the stream has started.  If using media operations is usually best to trigger off this event rather then the answered to ensure the media path is there
			case 'stream':
				break;
							
			case 'streaming':
				break;
			
			//This event indicates that your media operation has started on the channel
			case 'media_started':
				break;
			
			//Indication that the play has completed
			case 'end_play':
				
				break;
			case 'end_record':
				//In this test case, we will keep call connected forever, but if you wish the XMS to terminate the call instead
				// the following can be uncommented
				//DropCall(href);
				break;
			//This event is sent periodicly to let app know that the server and call are still alive
			case 'keepalive':
				logger.log('debug','XMS->S: keepalive event');
				break;
			//Generated when the RTP stream is no longer being detected by the XMS
			case 'alarm':
				break;
			//Generated when the call gets 180 ringing back
			case 'ringing':
				break;
			//Generated when the call is connected
			case 'connected':
				JoinCalls(href,SiptoWsHrefMap[href]);
				break;
			//All other events are just logged and ignored
			default:
				logger.log('warn',"Unknown event detected:\n"+evt.web_service.event[0].$.type);
				break;
			}
		} else {
			//Really shouldn't ever be able to get here as there is a check in event receiver.
			logger.log('error',"Event did not contain a web_service");
		}
	});	
}

// Functions used to send REST messages for different operations (Answer,Play,Record,Dropcall)
function AnswerCall(href){
  var url='http://'+argv.hostname+':'+argv.port+'/default/calls/'+href+'?appid='+argv.appid;
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call answer=\"yes\" async_completion=\"yes\" media=\"audiovideo\"/></web_service>";
    
  var options={
	method: 'PUT',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('debug','S->XMS: PUT to '+url+':\n');
   request(options, function(error,response,body){
	logger.log('debug',"XMS->S: RESPONSE: %j body",response);
	if(!error && response.statusCode == 200){
		logger.log('info',href+' - Answer Initiated, waiting on answered event');
	} else {
		logger.error(href+' - Error answering Call('+href+') statusCode='+response.statusCode);
	}
   });

}
function Play(href, playfile){
  var url='http://'+argv.hostname+':'+argv.port+'/default/calls/'+href+'?appid='+argv.appid;
  
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call><call_action><play offset=\"0s\" delay=\"0s\" repeat=\"0\" terminate_digits=\"#\"><play_source location=\"file://verification/video_clip_newscast\"/></play></call_action></call></web_service>";
  var options={
	method: 'PUT',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('debug','S->XMS: PUT to '+url+':\n');
   request(options, function(error,response,body){
	logger.log('debug',"XMS->S: RESPONSE: %j body",response);
	if(!error && response.statusCode == 200){
		logger.log('info',href+' - Play of '+playfile+' Initiated, waiting on play_end event');
	} else {
		logger.error(href+' - Error Playing file('+href+') statusCode='+response.statusCode);
	}
   });

}
function Record(href, recfile){
  var url='http://'+argv.hostname+':'+argv.port+'/default/calls/'+href+'?appid='+argv.appid;
  
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call><call_action><record terminate_digits=\"#\" max_time=\"30s\" recording_audio_type=\"audio/x-wav\" recording_audio_uri=\"file://"+recfile+"\"><recording_audio_mime_params codec=\"L16\" rate=\"16000\"/></record></call_action></call></web_service>";
  var options={
	method: 'PUT',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('debug','S->XMS: PUT to '+url+':\n');
   logger.log('info',href+' - Sending Record ');
   request(options, function(error,response,body){
	logger.log('debug',"XMS->S: RESPONSE: %j body",response);
	if(!error && response.statusCode == 200){
		logger.log('info',href+' - Record of '+recfile+' Initiated, waiting on record_end event');
	} else {
		logger.error(href+' - Error Recording file('+href+') statusCode='+response.statusCode);
	}
   });

}

function DropCall(href,callback){
  if(!callback) callback=function(err,href){};
  var url='http://'+argv.hostname+':'+argv.port+'/default/calls/'+href+'?appid='+argv.appid;
  var options={
	method: 'DELETE',
	url: url,
	headers:headers,
	};
   logger.log('verbose','S->XMS: DELETE of '+href+':\n');
   
   request(options, function(error,response){
	logger.log('verbose',"XMS->S: "+response.statusCode+" Received on "+href);
	if(error){
		logger.error(href+' - Error DELETEing Call('+href+') statusCode='+response.statusCode);
	} else {
		logger.log('info',href+' - Call has been DELETED (statusCode='+response.statusCode+')');
		//Find the call and remove it from the callers list
		var index=callers.indexOf(href);
		if (index > -1) {
			callers.splice(index,1);
		}
	}
	return callback(error,href);
   });

}
function MakeSipCall(dest, callback){
	if(!callback) callback=function(err,href){};
   //TODO, may need to escape the dest
   logger.log('silly','resolve is %j',dest);
   var url='http://'+argv.hostname+':'+argv.port+'/default/calls?appid='+argv.appid;
  
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call media=\"audiovideo\"  destination_uri=\""+dest+"\" rtcp_feedback=\"audiovideo\" /></web_service>";
   var href=null;
  var options={
	method: 'POST',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('info','S->XMS: POST to MakeCall call to '+dest);
   logger.log('debug','[ '+data+' ]');
   request(options, function(error,response,body){
	logger.log('verbose',"XMS->S: "+response.statusCode+" RESPONSE");
	logger.log('debug','[ '+body+' ]');
	if(!error && response.statusCode == 201){
		
		//Here we need to parse the response for the href that will be used to reference the call
			//logger.log('verbose',body);
			parseString(body,function(err,result){
			if(err){
				logger.error(err);
			}
			//Here we need to parse the response for the href that will be used to start the long poll
			href=result.web_service.call_response[0].$.identifier;		
			callers.push(href);
			logger.log('silly',"new call href="+href)  ;
			logger.log('info','Started new SIP XMS call to '+dest+' href=',href);
			});
			
		
	} else {
		logger.error('Error Creating call to '+dest+' statusCode='+response.statusCode);
		
	}
	return callback(error,href);
   });
  
}
function CreateWebCallOnXMS(ws, callback){
   if(!callback) callback=function(err,href){};
   
   logger.log('silly','resolve is %j',ws);
   var url='http://'+argv.hostname+':'+argv.port+'/default/calls?appid='+argv.appid;
   var sdp=ws.ClientSdp.replace(/\n/g,'&#xA;').replace(/\r/g,'&#xD;'); //Line Feed and CR replaces
 
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call media=\"audiovideo\" signaling=\"no\" sdp=\""+sdp+"\" encryption=\"dtls\" ice=\"yes\" rtcp_feedback=\"audiovideo\" gusid=\""+ws.ClientToken+"\" /></web_service>";
   
  var options={
	method: 'POST',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('info','S->XMS: POST to create call for Token='+ws.ClientToken);
   logger.log('debug','[ '+data+' ]');
   request(options, function(error,response,body){
	logger.log('verbose',"XMS->S: "+response.statusCode+" RESPONSE on Token="+ws.ClientToken);
	logger.log('debug','[ '+body+' ]');
	if(!error && response.statusCode == 201){
		
		//Here we need to parse the response for the href that will be used to reference the call
			//logger.log('verbose',body);
			parseString(body,function(err,result){
			if(err){
				logger.error(err);
			}
			//Here we need to parse the response for the href that will be used to start the long poll
			var clienthref=result.web_service.call_response[0].$.identifier;
			ws.clienthref=clienthref;
			callers.push(clienthref);
			logger.log('silly',"new call href="+clienthref)  ;
			var clientxmsurl='http://'+argv.hostname+':'+argv.port+clienthref+'?appid='+argv.appid;
			ws.clientxmsurl=clientxmsurl;
			var XmsSdp=result.web_service.call_response[0].$.sdp;
			XmsSdp.replace(/&#xA;/g,'\n').replace(/'&#xD;'/g,'\r'); //Line Feed and CR replaces
			ws.XmsSdp=XmsSdp;
			logger.log('silly',"XmsSdp is="+XmsSdp);
			logger.log('info','Created New XMS call for web client token '+ws.ClientToken+' href=',clienthref);
			});
			
		
	} else {
		logger.error('Error Creating call for ClientToken='+ws.ClientToken+' statusCode='+response.statusCode);
		
	}
	return callback(error,ws);
   });
  
}

function JoinCalls(href,otherhref,callback){
  if(!callback) callback=function(err,href){};
  var url='http://'+argv.hostname+':'+argv.port+'/default/calls/'+href+'?appid='+argv.appid;
   var data="<?xml version=\"1.0\" encoding=\"UTF-8\"?><web_service version=\"1.0\"><call><call_action><join call_id=\""+otherhref+"\" audio=\"sendrecv\" video=\"sendrecv\" /></call_action></call></web_service>";
  
    
  var options={
	method: 'PUT',
	url: url,
	headers:headers,
	body: data
	};
   logger.log('debug','S->XMS: PUT to join two calls'+href+' and'+otherhref+'\n');
   request(options, function(error,response,body){
	logger.log('debug',"XMS->S: RESPONSE: %j body",response);
	if(!error && response.statusCode == 200){
		logger.log('info',href+' - Join Initiated to '+otherhref);
	} else {
		logger.error(href+' - Error join Calls('+href+' and'+otherhref+') statusCode='+response.statusCode);
	}
	return callback(error,href);
   });

}

