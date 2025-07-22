function getRandomInt(max = Number.MAX_SAFE_INTEGER) {
  return Math.floor(Math.random() * max);
};

// Function to generate a random 5-character string
function generateRandomString(length) {
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

function getRandomData(num_rows = 10){
    return Array(getRandomInt(num_rows)+1).fill().map( e => [
                generateRandomString(10),  
                getRandomInt(10), 
                getRandomInt(20), 
                getRandomInt(30), 
            ]);
}

async function loadJSON(url){
        
    const response = await fetch(url);

    return response.ok ? await response.json() : [];
}