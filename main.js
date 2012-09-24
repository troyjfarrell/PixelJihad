// initialize
window.onload = function() {
    // add action to the file input
    var input = document.getElementById('file');
    input.addEventListener('change', importImage);

    // add action to the encode button
    var encodeButton = document.getElementById('encode');
    encodeButton.addEventListener('click', encode);

    // add action to the decode button
    var decodeButton = document.getElementById('decode');
    decodeButton.addEventListener('click', decode);

    // add action to the analyze button
    var decodeButton = document.getElementById('analyze');
    decodeButton.addEventListener('click', analyze);
    // necessary because the button doesn't have any input elements with it
    decodeButton.disabled = false;
};

// artificially limit the message size
var maxMessageSize = 1000;

// put image in the canvas and display it
var importImage = function(e) {
    var reader = new FileReader();

    reader.onload = function(event) {
        // set the preview
        document.getElementById('preview').style.display = 'block';
        document.getElementById('preview').src = event.target.result;

        // wipe all the fields clean
        document.getElementById('message').value = '';
        document.getElementById('password').value = '';
        document.getElementById('password2').value = '';
        document.getElementById('messageDecoded').innerHTML = '';

        // read the data into the canvas element
        var img = new Image();
        img.onload = function() {
            var ctx = document.getElementById('canvas').getContext('2d');
            ctx.canvas.width = img.width;
            ctx.canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            decode();
        };
        img.src = event.target.result;
    };

    reader.readAsDataURL(e.target.files[0]);
};

// encode the image and save it
var encode = function() {
    var message = document.getElementById('message').value;
    var password = document.getElementById('password').value;
    var canvas = document.getElementById('canvas');
    var ctx = canvas.getContext('2d');

    // encrypt the message with supplied password if necessary
    if (password.length > 0) {
        message = sjcl.encrypt(password, message);
    } else {
        message = JSON.stringify({'text': message});
    }

    // exit early if the message is too big for the image
    var pixelCount = ctx.canvas.width * ctx.canvas.height;
    if ((message.length + 1) * 16 > pixelCount * 4 * 0.75) {
        alert('Message is too big for the image.');
        return;
    }

    // exit early if the message is above an artificial limit
    if (message.length > maxMessageSize) {
        alert('Message is too big.');
        return;
    }

    // encode the encrypted message with the supplied password
    var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    encodeMessage(imgData.data, sjcl.hash.sha256.hash(password), message);
    ctx.putImageData(imgData, 0, 0);

    // view the new image
    alert('Done! When the image appears, save and share it with someone.');
    window.location = canvas.toDataURL();
};

// decode the image and display the contents if there is anything
var decode = function() {
    var password = document.getElementById('password2').value;
    var passwordFail = 'Password is incorrect or there is nothing here.';

    // decode the message with the supplied password
    var ctx = document.getElementById('canvas').getContext('2d');
    var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    var message = decodeMessage(imgData.data, sjcl.hash.sha256.hash(password));

    // try to parse the JSON
    var obj = null;
    try {
        obj = JSON.parse(message);
    } catch (e) {
        // display the "choose" view

        document.getElementById('choose').style.display = 'block';
        document.getElementById('reveal').style.display = 'none';

        if (password.length > 0) {
            alert(passwordFail);
        }
    }

    // display the "reveal" view
    if (obj) {
        document.getElementById('choose').style.display = 'none';
        document.getElementById('reveal').style.display = 'block';

        // decrypt if necessary
        if (obj.ct) {
            try {
                obj.text = sjcl.decrypt(password, message);
            } catch (e) {
                alert(passwordFail);
            }
        }

        // escape special characters
        var escChars = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#39;',
            '/': '&#x2F;',
            '\n': '<br/>'
        };
        var escHtml = function(string) {
            return String(string).replace(/[&<>"'\/\n]/g, function (c) {
                return escChars[c];
            });
        };
        document.getElementById('messageDecoded').innerHTML = escHtml(obj.text);
    }
};

var analyze = function() {
    // elements
    var analysis = document.getElementById('analysis');
    var button = document.getElementById('analyze');
    var canvas = document.getElementById('canvas');

    // image data
    var ctx = canvas.getContext('2d');
    var pixelCount = ctx.canvas.width * ctx.canvas.height;
    var pixelSize = 4; // RGBA
    var imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    // analysis data
    var aCtx = analysis.getContext('2d');
    analysis.width = imgData.width;
    analysis.height = imgData.height;
    var aImgData = aCtx.getImageData(0, 0, imgData.width, imgData.height);
    var aData = aImgData.data;

    button.disabled = true;

    var previ = 0;

    // iterate over the rows of the image
    for(var i = 0; i < imgData.height; i++)
    {
        // iterate over the pixels of this row
        for(var j = 0; j < imgData.width; j++)
        {
            var alphaIndex = getIndexForXYChannel(j, i, 3, imgData.width);
            var alphaValue = imgData.data[alphaIndex];
            aData[alphaIndex] = 0xff;
            
            // If this pixel is not opaque, skip it.
            if (0xff != alphaValue)
            {
                aData[alphaIndex - 3] = 0x00;
                aData[alphaIndex - 2] = 0x00;
                aData[alphaIndex - 1] = 0x00;
                continue;
            }

            var suspectPixelCount = 0;

            // iterate over the chanels of this pixel
            // (pixelSize - 1) is to exclude the alpha channel
            for(var k = 0; k < (pixelSize - 1); k++)
            {
                // shortcut
                if (suspectPixelCount > 1)
                {
                    continue;
                }

                var pcd = getPixelChannelData(imgData, j, i, k);
                // If only the least-significant bit of the pixel channel data
                // differs from most of the surrounding pixels, the pixel may
                // be hiding information.
                var matchCount = 0;
                var pixelValue = pcd.pixelChannelValue;
                for(var m = 0; m < pcd.surroundingChannelValues.length; m++)
                {
                    var otherPCV = pcd.surroundingChannelValues[m];
                    if ((pixelValue >> 1) == (otherPCV >> 1) &&
                        (pixelValue & 0x1) != (otherPCV & 0x1))
                    {
                        matchCount++;
                    }
                }

                if (!!Math.round(matchCount / m))
                {
                    suspectPixelCount++;
                    if (suspectPixelCount > 1)
                    {
                        // If this pixel is already marked as suspect, then it
                        // may really be at a color boundary in the image.
                        for(var n = 0; n < k; n++)
                        {
                            var width = imgData.width;
                            aData[getIndexForXYChannel(j, i, n, width)] = 0x00;
                        }
                    }
                    else
                    {
                        // mark the value suspect in the analysis
                        aData[pcd.pixelChannelIndex] = 0xff;
                    }
                }
                else
                {
                    aData[pcd.pixelChannelIndex] = 0x00;
                }
            }
        }
    }

    aCtx.putImageData(aImgData, 0, 0);

    button.disabled = false;
    window.location = analysis.toDataURL();
};

// get data for one channel of one pixel
var getPixelChannelData = function(imgData, x, y, channel) {
    var width = imgData.width;
    var pixelChannelIndex = getIndexForXYChannel(x, y, channel, width);
    var pixelChannelValue = imgData.data[pixelChannelIndex];

    // surrounding pixel channel values
    var sPCVs = [];
    var pixelIndex = 0;
    // row above
    if (y > 0)
    {
        // pixel above and to the left
        if (x > 0)
        {
            pixelIndex = getIndexForXYChannel(x - 1, y - 1, channel, width);
            sPCVs.push(imgData.data[pixelIndex]);
        }
        // pixel above
        pixelIndex = getIndexForXYChannel(x, y - 1, channel, width);
        sPCVs.push(imgData.data[pixelIndex]);
        // pixel above and to the right
        if (x < imgData.width - 1)
        {
            pixelIndex = getIndexForXYChannel(x + 1, y - 1, channel, width);
            sPCVs.push(imgData.data[pixelIndex]);
        }
    }
    // pixel to the left
    if (x > 0)
    {
        pixelIndex = getIndexForXYChannel(x - 1, y, channel, width);
        sPCVs.push(imgData.data[pixelIndex]);
    }
    // pixel to the right
    if (x < imgData.width - 1)
    {
        pixelIndex = getIndexForXYChannel(x + 1, y, channel, width);
        sPCVs.push(imgData.data[pixelIndex]);
    }
    // row below
    if (y < imgData.height - 1)
    {
        // pixel below and to the left
        if (x > 0)
        {
            pixelIndex = getIndexForXYChannel(x - 1, y + 1, channel, width);
            sPCVs.push(imgData.data[pixelIndex]);
        }
        // pixel below 
        pixelIndex = getIndexForXYChannel(x - 1, y, channel, width);
        sPCVs.push(imgData.data[pixelIndex]);
        // pixel below and to the right
        if (x < imgData.width - 1)
        {
            pixelIndex = getIndexForXYChannel(x + 1, y + 1, channel, width);
            sPCVs.push(imgData.data[pixelIndex]);
        }
    }

    var result = {
        pixelChannelIndex: pixelChannelIndex,
        pixelChannelValue: pixelChannelValue,
        surroundingChannelValues: sPCVs
    };
    return result;
};

// get pixel channel index
var getIndexForXYChannel = function (x, y, channel, width) {
    var pixelSize = 4;
    return (y * width * pixelSize) + (x * pixelSize) + channel;
};

// returns a 1 or 0 for the bit in 'location'
var getBit = function(number, location) {
   return ((number >> location) & 1);
};

// sets the bit in 'location' to 'bit' (either a 1 or 0)
var setBit = function(number, location, bit) {
   return (number & ~(1 << location)) | (bit << location);
};

// returns an array of 1s and 0s for a 2-byte number
var getBitsFromNumber = function(number) {
   var bits = [];
   for (var i = 0; i < 16; i++) {
       bits.push(getBit(number, i));
   }
   return bits;
};

// returns the next 2-byte number
var getNumberFromBits = function(bytes, history, hash) {
    var number = 0, pos = 0;
    while (pos < 16) {
        var loc = getNextLocation(history, hash, bytes.length);
        var bit = getBit(bytes[loc], 0);
        number = setBit(number, pos, bit);
        pos++;
    }
    return number;
};

// returns an array of 1s and 0s for the string 'message'
var getMessageBits = function(message) {
    var messageBits = [];
    for (var i = 0; i < message.length; i++) {
        var code = message.charCodeAt(i);
        messageBits = messageBits.concat(getBitsFromNumber(code));
    }
    return messageBits;
};

// gets the next location to store a bit
var getNextLocation = function(history, hash, total) {
    var pos = history.length;
    var loc = Math.abs(hash[pos % hash.length] * (pos + 1)) % total;
    while (true) {
        if (loc >= total) {
            loc = 0;
        } else if (history.indexOf(loc) >= 0) {
            loc++;
        } else if ((loc + 1) % 4 === 0) {
            loc++;
        } else {
            history.push(loc);
            return loc;
        }
    }
};

// encodes the supplied 'message' into the CanvasPixelArray 'colors'
var encodeMessage = function(colors, hash, message) {
    // make an array of bits from the message
    var messageBits = getBitsFromNumber(message.length);
    messageBits = messageBits.concat(getMessageBits(message));

    // this will store the color values we've already modified
    var history = [];

    // encode the bits into the pixels
    var pos = 0;
    while (pos < messageBits.length) {
        // set the next color value to the next bit
        var loc = getNextLocation(history, hash, colors.length);
        colors[loc] = setBit(colors[loc], 0, messageBits[pos]);

        // set the alpha value in this pixel to 255
        // we have to do this because browsers do premultiplied alpha
        // see for example: http://stackoverflow.com/q/4309364
        while ((loc + 1) % 4 !== 0) {
            loc++;
        }
        colors[loc] = 255;

        pos++;
    }
};

// returns the message encoded in the CanvasPixelArray 'colors'
var decodeMessage = function(colors, hash) {
    // this will store the color values we've already read from
    var history = [];

    // get the message size
    var messageSize = getNumberFromBits(colors, history, hash);

    // exit early if the message is too big for the image
    if ((messageSize + 1) * 16 > colors.length * 0.75) {
        return '';
    }

    // exit early if the message is above an artificial limit
    if (messageSize === 0 || messageSize > maxMessageSize) {
        return '';
    }

    // put each character into an array
    var message = [];
    for (var i = 0; i < messageSize; i++) {
        var code = getNumberFromBits(colors, history, hash);
        message.push(String.fromCharCode(code));
    }

    // the characters should parse into valid JSON
    return message.join('');
};
