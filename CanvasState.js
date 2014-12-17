CanvasState = function(canvas, mongoCol, polyCollection) {
	// **** First some setup! ****

	this.canvas = canvas;
	this.width = canvas.width;
	this.height = canvas.height;
	this.ctx = canvas.getContext('2d');
	this.collection = mongoCol;
	this.polyCollection = polyCollection;
	this.creatingElement = new ReactiveVar(false);
	this.insertMode = 'rect';
	this.createdId = new ReactiveVar(0);
	// This complicates things a little but but fixes mouse co-ordinate problems
	// when there's a border or padding. See getMouse for more detail
	var stylePaddingLeft, stylePaddingTop, styleBorderLeft, styleBorderTop;
	if (document.defaultView && document.defaultView.getComputedStyle) {
		this.stylePaddingLeft = parseInt(document.defaultView.getComputedStyle(canvas, null)['paddingLeft'], 10) || 0;
		this.stylePaddingTop = parseInt(document.defaultView.getComputedStyle(canvas, null)['paddingTop'], 10) || 0;
		this.styleBorderLeft = parseInt(document.defaultView.getComputedStyle(canvas, null)['borderLeftWidth'], 10) || 0;
		this.styleBorderTop = parseInt(document.defaultView.getComputedStyle(canvas, null)['borderTopWidth'], 10) || 0;
	}
	// Some pages have fixed-position bars (like the stumbleupon bar) at the top or left of the page
	// They will mess up mouse coordinates and this fixes that
	var html = document.body.parentNode;
	this.htmlTop = html.offsetTop;
	this.htmlLeft = html.offsetLeft;

	// **** Keep track of state! ****

	this.valid = false; // when set to false, the canvas will redraw everything
	this.shapes = []; // the collection of things to be drawn
	this.dragging = false; // Keep track of when we are dragging
	// the current selected object. In the future we could turn this into an array for multiple selection
	this.selection = new ReactiveVar(null);
	this.dragoffx = 0; // See mousedown and mousemove events for explanation
	this.dragoffy = 0;

	// **** Then events! ****

	// This is an example of a closure!
	// Right here "this" means the CanvasState. But we are making events on the Canvas itself,
	// and when the events are fired on the canvas the variable "this" is going to mean the canvas!
	// Since we still want to use this particular CanvasState in the events we have to save a reference to it.
	// This is our reference!
	var myState = this;

	//fixes a problem where double clicking causes text to get selected on the canvas
	canvas.addEventListener('selectstart', function(e) {
		e.preventDefault();
		return false;
	}, false);
	// Up, down, and move are for dragging
	canvas.addEventListener('mousedown', mousedown, true);
	canvas.addEventListener('touchstart', mousedown, true);

	function mousedown(e) {
		e.preventDefault();
		e.stopPropagation();
		var mouse = myState.getMouse(e);
		var mx = mouse.x;
		var my = mouse.y;
		var shapes = myState.shapes;
		var l = shapes.length;
		// tmp var if one gets selected
		var tmpSelected = false;
		var alreadySelected = myState.selection.get();
		if (myState.creatingElement.get() === true) {
			var newPoint = {
				x: mouse.x,
				y: mouse.y
			};
			if (myState.createdId.get() === 0) {
				if (alreadySelected === null) {
					console.log('Nothing selected to add something onto!');
					return;
				}
			}
			if (myState.insertMode === 'poly') {
				if (myState.createdId.get() !== 0) {
					addPointToPolyDoc(newPoint, myState, myState.createdId.get(), polyCollection);
					return;
				}
			}
			if (alreadySelected !== null) {
				alreadySelected.addPoint(newPoint);
			}
			return;
		}
		for (var i = l - 1; i >= 0; i--) {
			var mySel = shapes[i];
			if (shapes[i].contains(mx, my) && tmpSelected === false) {
				// check if this shape is already selected
				if (myState.selection.get() === mySel) {
					if (shapes[i].touchedAtHandles(mx, my)) {
						// in this case the shape is touched at the handles -> resize
						// pass event to shape event handler and begin possible resizing
						if (mySel instanceof Shape) {
							mouseDownSelected(e, mySel);
							myState.resizing = true;
						}
						if (mySel instanceof Polygon) {
							mySel.mouseDown(e, mouse);
							myState.resizing = true;
						}
					} else {
						// in this case the shape is touched, but NOT at the handles -> drag
						// Keep track of where in the object we clicked
						// so we can move it smoothly (see mousemove)
						if (mySel instanceof Shape) {
							myState.dragoffx = mx - mySel.x;
							myState.dragoffy = my - mySel.y;
						}
						if (mySel instanceof Polygon) {
							// store drag start points
							myState.dragoffx = mx;
							myState.dragoffy = my;
						}
						myState.dragging = true;
					}
				}
				myState.selection.set(mySel);
				// set the state of the shape as selected
				mySel.selected = true;
				myState.valid = false;
				tmpSelected = true;
				// return;
			} else {
				// unset the state of the shape as selected
				mySel.deselect();
				myState.valid = false;
			}
		}
		// if no shape was touched
		if (tmpSelected === false) {
			myState.selection.set(null);
		}
		// havent returned means we have failed to select anything.

	}
	canvas.addEventListener('mousemove', mousemove, true);
	canvas.addEventListener('touchmove', mousemove, true);

	function mousemove(e) {
		e.preventDefault();
		e.stopPropagation();
		var mouse = myState.getMouse(e);
		this.style.cursor = 'auto';
		var mySel = myState.selection.get();
		if (myState.dragging) {
			if (mySel instanceof Shape) {
				// We don't want to drag the object by its top-left corner, we want to drag it
				// from where we clicked. Thats why we saved the offset and use it here
				mySel.x = mouse.x - myState.dragoffx;
				mySel.y = mouse.y - myState.dragoffy;
				myState.valid = false; // Something's dragging so we must redraw
				mySel.valid = false; // store information to database when rect gets drawn
			}
			if (mySel instanceof Polygon) {
				var translation = {
					x: mouse.x - myState.dragoffx,
					y: mouse.y - myState.dragoffy
				};
				mySel.move(e, translation);
				myState.dragoffx = mouse.x;
				myState.dragoffy = mouse.y;
			}
		}
		if (myState.resizing) {
			if (mySel instanceof Shape) {
				mouseMoveSelected(e, mySel);
			}
			if (mySel instanceof Polygon) {
				mySel.mouseMove(e, mouse);
			}
		}
	}
	canvas.addEventListener('mouseup', function(e) {
		myState.dragging = false;
		myState.resizing = false;
		mouseUpSelected(e);
	}, true);
	// double click for making new shapes
	canvas.addEventListener('dblclick', dblclick, true);

	function dblclick(e) {
		if (myState.creatingElement.get() === true) {
			return;
		}
		var mouse = myState.getMouse(e);
		var r = Math.floor(Math.random() * 255);
		var g = Math.floor(Math.random() * 255);
		var b = Math.floor(Math.random() * 255);
		if (myState.insertMode === 'rect') {
			// myState.addShape(new Shape(mouse.x - 10, mouse.y - 10, 20, 20, 'rgba(' + r + ',' + g + ',' + b + ',.6)'));
			counter = myState.collection.find().fetch().length;
			myState.collection.insert({
				coords: {
					x: mouse.x - 10,
					y: mouse.y - 10,
					w: 100,
					h: 100,
				},
				color: {
					r: r,
					g: g,
					b: b
				},
				name: 'Shape ' + counter
			});
		}
		if (myState.insertMode === 'poly') {
			counter = myState.polyCollection.find().fetch().length;
			var id = myState.polyCollection.insert({
				coords: [{
					x: mouse.x,
					y: mouse.y
				}],
				color: {
					r: r,
					g: g,
					b: b
				},
				name: 'Poly ' + counter
			});
			myState.createdId.set(id);
			myState.creatingElement.set(true);
		}
	}

	// mouse down handler for selected state
	mouseDownSelected = function(e, shape) {
		var mouse = myState.getMouse(e);
		var mouseX = mouse.x;
		var mouseY = mouse.y;
		var self = shape;

		// if there isn't a rect yet
		if (self.w === undefined) {
			self.x = mouseY;
			self.y = mouseX;
			myState.dragBR = true;
		}

		// if there is, check which corner
		//   (if any) was clicked
		//
		// 4 cases:
		// 1. top left
		else if (checkCloseEnough(mouseX, self.x, self.closeEnough) && checkCloseEnough(mouseY, self.y, self.closeEnough)) {
			myState.dragTL = true;
			e.target.style.cursor = 'nw-resize';
		}
		// 2. top right
		else if (checkCloseEnough(mouseX, self.x + self.w, self.closeEnough) && checkCloseEnough(mouseY, self.y, self.closeEnough)) {
			myState.dragTR = true;
			e.target.style.cursor = 'ne-resize';
		}
		// 3. bottom left
		else if (checkCloseEnough(mouseX, self.x, self.closeEnough) && checkCloseEnough(mouseY, self.y + self.h, self.closeEnough)) {
			myState.dragBL = true;
			e.target.style.cursor = 'sw-resize';
		}
		// 4. bottom right
		else if (checkCloseEnough(mouseX, self.x + self.w, self.closeEnough) && checkCloseEnough(mouseY, self.y + self.h, self.closeEnough)) {
			myState.dragBR = true;
			e.target.style.cursor = 'se-resize';
		}
		// (5.) none of them
		else {
			// handle not resizing
		}
		myState.valid = false; // something is resizing so we need to redraw
	};
	mouseUpSelected = function(e) {
		myState.dragTL = myState.dragTR = myState.dragBL = myState.dragBR = false;
	};
	mouseMoveSelected = function(e, shape) {
		var mouse = myState.getMouse(e);
		var mouseX = mouse.x;
		var mouseY = mouse.y;

		if (myState.dragTL) {
			e.target.style.cursor = 'nw-resize';
			// switch to top right handle
			if (((shape.x + shape.w) - mouseX) < 0) {
				myState.dragTL = false;
				myState.dragTR = true;
			}
			// switch to top bottom left
			if (((shape.y + shape.h) - mouseY) < 0) {
				myState.dragTL = false;
				myState.dragBL = true;
			}
			shape.w += shape.x - mouseX;
			shape.h += shape.y - mouseY;
			shape.x = mouseX;
			shape.y = mouseY;
		} else if (myState.dragTR) {
			e.target.style.cursor = 'ne-resize';
			// switch to top left handle
			if ((shape.x - mouseX) > 0) {
				myState.dragTR = false;
				myState.dragTL = true;
			}
			// switch to bottom right handle
			if (((shape.y + shape.h) - mouseY) < 0) {
				myState.dragTR = false;
				myState.dragBR = true;
			}
			shape.w = Math.abs(shape.x - mouseX);
			shape.h += shape.y - mouseY;
			shape.y = mouseY;
		} else if (myState.dragBL) {
			e.target.style.cursor = 'sw-resize';
			// switch to bottom right handle
			if (((shape.x + shape.w) - mouseX) < 0) {
				myState.dragBL = false;
				myState.dragBR = true;
			}
			// switch to top left handle
			if ((shape.y - mouseY) > 0) {
				myState.dragBL = false;
				myState.dragTL = true;
			}
			shape.w += shape.x - mouseX;
			shape.h = Math.abs(shape.y - mouseY);
			shape.x = mouseX;
		} else if (myState.dragBR) {
			e.target.style.cursor = 'se-resize';
			// switch to bottom left handle
			if ((shape.x - mouseX) > 0) {
				myState.dragBR = false;
				myState.dragBL = true;
			}
			// switch to top right handle
			if ((shape.y - mouseY) > 0) {
				myState.dragBR = false;
				myState.dragTR = true;
			}
			shape.w = Math.abs(shape.x - mouseX);
			shape.h = Math.abs(shape.y - mouseY);
		}

		myState.valid = false; // something is resizing so we need to redraw
		myState.selection.get().valid = false; // store information to database when rect gets drawn
	};
	// **** Options! ****

	this.selectionColor = '#000000';
	this.selectionWidth = 0.5;
	this.interval = 30;
	setInterval(function() {
		myState.draw();
	}, myState.interval);
};

CanvasState.prototype.addShape = function(shape) {
	this.shapes.push(shape);
	this.valid = false;
};

CanvasState.prototype.clear = function() {
	this.ctx.clearRect(0, 0, this.width, this.height);
};

// While draw is called as often as the INTERVAL variable demands,
// It only ever does something if the canvas gets invalidated by our code
CanvasState.prototype.draw = function() {
	// if our state is invalid, redraw and validate!
	if (!this.valid) {
		var ctx = this.ctx;
		var shapes = this.shapes;
		var mySel = this.selection.get();
		this.clear();

		// ** Add stuff you want drawn in the background all the time here **

		// draw all shapes
		var l = shapes.length;
		for (var i = 0; i < l; i++) {
			var shape = shapes[i];
			if (mySel !== shape) {
				// draw this shape as last
				// We can skip the drawing of elements that have moved off the screen:
				if (shape.x > this.width || shape.y > this.height ||
					shape.x + shape.w < 0 || shape.y + shape.h < 0) continue;
				shapes[i].draw(ctx);
			}
		}
		// draw selected shape
		if (mySel !== null) {
			mySel.draw(ctx);
		}

		// ** Add stuff you want drawn on top all the time here **

		this.valid = true;
	}
};

// Creates an object with x and y defined, set to the mouse position relative to the state's canvas
// If you wanna be super-correct this can be tricky, we have to worry about padding and borders
CanvasState.prototype.getMouse = function(e) {
	var element = this.canvas,
		offsetX = 0,
		offsetY = 0,
		mx, my;

	// Compute the total offset
	if (element.offsetParent !== undefined) {
		do {
			offsetX += element.offsetLeft;
			offsetY += element.offsetTop;
		} while ((element = element.offsetParent));
	}

	// Add padding and border style widths to offset
	// Also add the <html> offsets in case there's a position:fixed bar
	offsetX += this.stylePaddingLeft + this.styleBorderLeft + this.htmlLeft;
	offsetY += this.stylePaddingTop + this.styleBorderTop + this.htmlTop;

	mx = e.pageX - offsetX;
	my = e.pageY - offsetY;

	// We return a simple javascript object (a hash) with x and y defined
	return {
		x: mx,
		y: my
	};
};

CanvasState.prototype.enableEditingMode = function() {
	this.creatingElement.set(true);
};

CanvasState.prototype.finishElementCreation = function() {
	var mySel = this.selection.get();
	// check if requirements for creating a valid element are fulfilled
	if (!mySel.mayBeCreated()) {
		// not fulfilled -> remove from database
		mySel.collection.remove({
			_id: mySel.id
		});
	}
	this.creatingElement.set(false);
};

// checks if two points are close enough to each other depending on the closeEnough param
checkCloseEnough = function(p1, p2, closeEnough) {
	return Math.abs(p1 - p2) < closeEnough;
};

// Draws a white rectangle with a black border around it
drawRectWithBorder = function(x, y, sideLength, ctx, borderColor, bgColor) {
	if (!borderColor) {
		borderColor = 'black';
	}
	if (!bgColor) {
		bgColor = 'white';
	}
	ctx.save();
	ctx.fillStyle = borderColor;
	ctx.fillRect(x - (sideLength / 2), y - (sideLength / 2), sideLength, sideLength);
	ctx.fillStyle = bgColor;
	ctx.fillRect(x - ((sideLength - 1) / 2), y - ((sideLength - 1) / 2), sideLength - 1, sideLength - 1);
	ctx.restore();
};