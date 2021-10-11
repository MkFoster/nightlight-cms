const express = require('express');
const multer  = require('multer');
const session = require('express-session');
const mongoSessionStore = require('connect-mongo');
const { body, validationResult } = require('express-validator');
const passport = require('passport');
const mongoose = require('mongoose');
const flash = require('connect-flash');
const sharp = require('sharp');
const fs = require('fs');

require('dotenv').config({path: 'variables.env'});

const clientPromise = mongoose.connect(process.env.DATABASE);
mongoose.Promise = global.Promise;
mongoose.connection.on('error', (err)=>{
    console.error(`Mongoose fail: ${err.message}`);
});

const app = express();
const port = 80;

app.set('trust proxy', 1)
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    store: mongoSessionStore.create({ mongoUrl: process.env.DATABASE })
}));
app.use(passport.initialize());
app.use(passport.session());

require('./models/Post');
require('./models/User');
const Post = mongoose.model('Post');
const User = mongoose.model('User');
// CHANGE: USE "createStrategy" INSTEAD OF "authenticate"
passport.use(User.createStrategy());

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());


const origUploadPath = 'static/images/original';
const upload = multer({ dest: origUploadPath });
const smallImageWidth = 450;
const smallImagePath = 'static/images/small/';
const smallImagePathPart = 'images/small/';
const mediumImageWidth = 800;
const mediumImagePath = 'static/images/medium/';
const mediumImagePathPart = 'images/medium/';
const largeImageWidth = 1400;
const largeImagePath ='static/images/large/';
const largeImagePathPart = 'images/large/';

//Make sure our directories are there. This is an immediately invoked function
//expression so we can do async/await at the top level
(async function() {
    try {
        await fs.promises.mkdir(origUploadPath, { recursive: true });
        await fs.promises.mkdir(smallImagePath, { recursive: true });
        await fs.promises.mkdir(mediumImagePath, { recursive: true });
        await fs.promises.mkdir(largeImagePath, { recursive: true });
    } catch (err) {
        console.log(err);
    }
})();

//Serve static content  I.e., http://localhost/test.html
app.use(express.static('./static'));

app.use(flash());

//Use EJS templates for pages with dynamic content
app.set('view engine', 'ejs');
app.set('views', './views');

app.get('/', async (request, response) => {
    try {
        const posts = await Post.find();
        response.render('pages/index', {posts: posts});
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
});

app.get('/post/:id', async (request, response) => {
    const post = await Post.findOne({ _id: request.params.id });
    response.render('pages/post', {post: post});
});

app.get('/dash', (request, response) => {
    response.render('pages/dash');
});

app.get('/login', (request, response) => {
    response.render('pages/login');
});

app.post('/loginsubmit', (request, response) => {
    console.log(request.body);
});

app.get('/register', (request, response) => {
    const flashes = request.flash();
    response.render('pages/register', {errorFlashes: flashes.error});
});

app.post('/register',
    body('name', 'Please enter your name').notEmpty(),
    body('email', 'Please enter a valid email address').isEmail().normalizeEmail({
        remove_dots: false,
        remove_extension: false,
        gmail_remove_subaddress: false
    }),
    body('password', 'Password Cannot be Blank!').notEmpty().isLength({ min: 8 }).isLength({ max: 100 }),
    body('password-confirm', 'Confirmed Password cannot be blank!').notEmpty(),
    body('password-confirm', 'Oops! Your passwords do not match').equals(body.password),
     (request, response) => {
        //next();
        const result = validationResult(request);
        if (Array.isArray(result?.errors) && result?.errors.length > 0) {
            console.log(result.errors.map(err => err.msg));
            //request.flash('error', result.errors); //result.errors.map(err => err.msg)
            response.render('pages/register', {title: 'Register', body: request.body, errors: result.errors});
            //response.redirect('/register');
            return; // stop the fn from running
        }
        console.log('worked!!');
});

app.get('/newpost', (request, response) => {
    response.render('pages/newpost');
});

/*app.get('/postsubmit', (request, response) => {
    response.render('pages/postsubmit');
});*/

app.post('/postsubmit', upload.array('images', 5), body('title').trim().escape(), body('description').trim().escape(), async function (request, response, next) {
    // req.files is array of `photos` files
    // req.body will contain the text fields, if there were any
    try {
        request.files.forEach(file=>{
            file['smallPathFilePart'] = smallImagePathPart + file.filename + '.webp';
            file['mediumPathFilePart'] = mediumImagePathPart + file.filename + '.webp';
            file['largePathFilePart'] = largeImagePathPart + file.filename + '.webp';
            file['smallPathFile'] = smallImagePath + file.filename + '.webp';
            file['mediumPathFile'] = mediumImagePath + file.filename + '.webp';
            file['largePathFile'] = largeImagePath + file.filename + '.webp';
        });
        const post = new Post({
            postDate: new Date(),
            title: request.body.title,
            description: request.body.description,
            images: request.files,
            author: 'Mark Foster'
        });
        await post.save();
        await resizeImages(request.files);
        response.render('pages/postpreview');
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
});

async function resizeImages(images) {
    try {
        images.forEach(async image => {
            await resizeImage(image);
        });
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
}

async function resizeImage(imageObj) {
    try {
        const image = sharp(imageObj.path);
        const imageMetadata = await image.metadata();
        if (imageMetadata.width > smallImageWidth) {
            await sharp(imageObj.path)
                .resize({width: smallImageWidth})
                .toFormat('webp')
                .toFile(imageObj.smallPathFile);
        }
        if (imageMetadata.width > mediumImageWidth) {
            await sharp(imageObj.path)
                .resize({width: mediumImageWidth})
                .toFormat('webp')
                .toFile(imageObj.mediumPathFile);
        }
        if (imageMetadata.width > largeImageWidth) {
            await sharp(imageObj.path)
                .resize({width: largeImageWidth})
                .toFormat('webp')
                .toFile(imageObj.largePathFile);
        }
    } catch(err) {
        console.error('failed');
        console.error(err);
    }
}

app.listen(port, () => {
    console.log(`Nightlight CMS started and listening on port ${port}`);
});