var http = require("http");
var async = require("async");
var mongoose = require('mongoose');
var Random = require("random-js");
var Game, UserEntry;

// Database bs
var db = mongoose.connection;
db.on('error', console.error);
db.once('open', function() {

  // Game Schema
  var gameSchema = new mongoose.Schema({
    appid: Number
  , title: String
  });
  Game = mongoose.model('Game', gameSchema);
  
  // UserEntry Schema
  var userEntrySchema = new mongoose.Schema({
    uid: Number
  , pinged: { type : Date, default: Date.now }
  , lastOnline: Number
  , totalGames: Number
  , library: [{
      game: {type: mongoose.Schema.Types.ObjectId, ref: 'Game'}
    , hours: Number
    , hoursForever: Number
    , lastPlayed: Number
    }]
  , error: String
  });
  UserEntry = mongoose.model('UserEntry', userEntrySchema);
});

mongoose.connect('mongodb://localhost/test');
// --End database bs

// THIS BE THE BUSINESS!
var totalPages = 172000000; // ! Be sure to keep this up to date
var maxRequests = 10;
var successGoal = 1000;
var currentAttempts = 0;
var currentSuccess = 0;
var delayMin = 0;
var delayMax = 0;
var random = new Random(Random.engines.mt19937().autoSeed());
var uidPrefix = 765611;

// Start pinging Steam's website
requestLoop();

function requestLoop(){
  // Generate a random UID.
  // Due to Javascript's integer limitations, only part of the full UID is
  // used. The rest is held in the variable uidPrefix, and is only needed
  // for appearances.
  var steamUID = 97960265729 + random.integer(0, totalPages);
  var url = "http://steamcommunity.com/profiles/"+uidPrefix.toString()+steamUID.toString()+"/games?tab=all"
  download(url, function(data) {
  
    // Check if the returned data is a user page
    // User pages are expected to have the 'rgGames' variable)
    if(data && data.indexOf("rgGames") !== -1){
    
      // Slice out the Javascript section containing the game library
      libraryString = data.slice(data.indexOf("rgGames"), data.length);
      libraryString = libraryString.slice(11, libraryString.indexOf("];"));
      
      // Evaluate the library string as an array
      gameLibrary = eval("[" + libraryString + "]");
      
      // Note that another ping attempt was made, and it returned a user page
      currentAttempts++;
      
      if (libraryString) {
        // If the library (the rgGames field) wasn't empty...
        
        var formattedGameLibrary = [];
        var completedCallbacks = 0;
        var asyncGameChecks = [];
        gameLibrary.forEach(function(item) {
          
          // If you've never seen the Async module in action, look it up on Google
          asyncGameChecks.push(function(callback) {
            // Check if the item is already in the Game collection
            Game.findOne({ appid: item.appid }, function(err, game) {
              if(err)
                callback(err)
              else {
                // If it isn't, save it as a new Game to the Game collection
                if(!game){
                  game = new Game( {
                    appid: item.appid
                  , title: item.name
                  });
                  game.save(function(err, game) {
                    if(err) return console.error(err);
                  });
                }
                
                // Properly format the game data for Mongoose and add it to an array
                if(item.hours_forever){
                  // If the game has been played, save the play times...
                  formattedGameLibrary.push({
                    game: game
                  , hours: item.hours
                  , hoursForever: item.hours_forever.replace(/,/g, '')
                  , lastPlayed: item.last_played
                  });
                }
                else {
                  // ... otherwise, do not include the play time fields
                  formattedGameLibrary.push({
                    game: game
                  });
                }
                
                callback(null);
              }
            }); //- End Game.findOne()
          }); //- End asyncGameChecks.push()
        }); //- End gameLibrary.forEach()
        
        async.parallel(asyncGameChecks, function(err){
          if(err)
            console.log("Error");
          else {
            // Make a user entry. These are not meant to be unique -- You can have
            // more than one entry for the same UID, they'll simply have different
            // time stamps. This should make it easy to track the same user over
            // time.
            var userEntry = new UserEntry({
              uid: steamUID
            , totalGames: gameLibrary.length
            , library: formattedGameLibrary
            });
            
            userEntry.save(function(err, userEntry) {
              if(err) return console.error(err);
              
              // Having added a new user entry, we mark one more successful request
              // Yay!
              currentSuccess++;
            });
          }
        }); //- End async.parallel()
      }
      else {
        // ... if the field 'rgGames' was empty, the account is either private
        // or has not been set up. Either way, we must note that the attempt
        // was made and that it returned a valid account page.
        var userEntry = new UserEntry({
          uid: steamUID
        , error: "no game data available"
        });
        
        userEntry.save(function(err, userEntry) {
          if(err) return console.error(err);
        });
        
      }
      process.stdout.write(currentSuccess + "/" + currentAttempts + " pings\033[0G");
    }
    // else -- Not a user page
   
    // Begin again again again again...
    requestLoop();
    
  });
}

// Utility function that downloads a URL and invokes
// callback with the data.
function download(url, callback) {
  http.get(url, function(res) {
    var data = "";
    res.on('data', function (chunk) {
      data += chunk;
    });
    res.on("end", function() {
      callback(data);
    });
  }).on("error", function() {
    callback(null);
  });
}
