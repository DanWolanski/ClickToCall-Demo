var http = require('http');

var fs = require('fs');
var path = require('path');
var ip = require("ip");

//Encryption informaiton
var key = fs.readFileSync('encryption/click2calldemo.key');
var cert = fs.readFileSync( 'encryption/click2calldemo.crt' );

var https = require('https');
const options = {
  key: key,
  cert: cert 
};

https.createServer(options,OnRequest).listen(8123);
console.log('Secure Server running at https://'+ip.address()+':8123/');
http.createServer(OnRequest).listen(8125);
console.log('Server running at http://'+ip.address()+':8125/');

function OnRequest(request, response) {
    console.log('\nRequest Received ');
//    console.log(request);
    var filePath = '.' + request.url;
    if (filePath == './')
        filePath = './index.html';
    console.log('   Fetching '+request.url);
    var extname = path.extname(filePath);
    var contentType = 'text/html';
    switch (extname) {
        case '.js':
            contentType = 'text/javascript';
            break;
        case '.css':
            contentType = 'text/css';
            break;
        case '.json':
            contentType = 'application/json';
            break;
        case '.png':
            contentType = 'image/png';
            break;      
        case '.jpg':
            contentType = 'image/jpg';
            break;
        case '.wav':
            contentType = 'audio/x-wav';
	    break;
	case '.amr':
	    contentType = 'audio/amr';
            break;
    }

    fs.readFile(filePath, function(error, content) {
        if (error) {
            if(error.code == 'ENOENT'){
				console.log('Request Complete - File Not Found 404 sent');
				response.writeHead(404);
				response.end();
                //fs.readFile('./404.html', function(error, content) {
                //    response.writeHead(200, { 'Content-Type': contentType });
                //    response.end(content, 'utf-8');
                //});
            }
            else {
                response.writeHead(500);
                response.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
                response.end(); 
				console.log('Request Complete - Error '+error.code);
            }
        }
        else {
            response.writeHead(200, { 'Content-Type': contentType });
            response.end(content, 'utf-8');
            console.log('Request Complete Successful (contentType:'+contentType+')');
        }
    });

}